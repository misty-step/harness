use anyhow::{bail, Result};

pub const START: &str = "<!-- shippr:recap:start -->";
pub const END: &str = "<!-- shippr:recap:end -->";

fn marker_span(text: &str) -> Result<Option<(usize, usize)>> {
    let starts: Vec<_> = text.match_indices(START).map(|(i, _)| i).collect();
    let ends: Vec<_> = text.match_indices(END).map(|(i, _)| i).collect();
    match (starts.as_slice(), ends.as_slice()) {
        ([], []) => Ok(None),
        ([start], [end]) if start < end => Ok(Some((*start, *end + END.len()))),
        _ => bail!("recap markers must form exactly one ordered start/end pair; duplicated or unbalanced markers found"),
    }
}

/// Replace only the inclusive marker span, preserving every surrounding byte.
/// A block's optional terminal newline is formatting, not part of its markers.
pub fn upsert(body: &str, block: &str) -> Result<String> {
    let block = block.strip_suffix("\r\n").or_else(|| block.strip_suffix('\n')).unwrap_or(block);
    match marker_span(block)? {
        Some((0, end)) if end == block.len() => {}
        _ => bail!("recap block must begin with the start marker and end with the end marker"),
    }
    if let Some((start, end)) = marker_span(body)? {
        let mut output = String::with_capacity(body.len() + block.len());
        output.push_str(&body[..start]);
        output.push_str(block);
        output.push_str(&body[end..]);
        return Ok(output);
    }
    if body.is_empty() {
        return Ok(block.to_owned());
    }
    let separator = if body.ends_with("\n\n") || body.ends_with("\r\n\r\n") {
        ""
    } else if body.ends_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    Ok(format!("{body}{separator}{block}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(content: &str) -> String {
        format!("{START}\n## System recap\n{content}\n{END}")
    }

    #[test]
    fn inserts_into_empty_body() {
        let block = block("new");
        assert_eq!(upsert("", &block).unwrap(), block);
    }

    #[test]
    fn appends_with_blank_line_preserving_original_body() {
        let block = block("new");
        for (body, separator) in [("description", "\n\n"), ("description\n", "\n"), ("description\n\n", ""), ("description\n\n\n", ""), ("description\r\n\r\n", "")] {
            assert_eq!(upsert(body, &block).unwrap(), format!("{body}{separator}{block}"));
        }
    }

    #[test]
    fn replacement_preserves_outside_bytes() {
        let prefix = "\u{feff}héllo\r\n  \n";
        let suffix = "\r\n\r\n尾\t ";
        let body = format!("{prefix}{}{suffix}", block("old"));
        assert_eq!(upsert(&body, &block("new")).unwrap(), format!("{prefix}{}{suffix}", block("new")));
    }

    #[test]
    fn works_with_inline_markers() {
        let body = format!("prefix{START}old{END}suffix");
        assert_eq!(upsert(&body, &block("new")).unwrap(), format!("prefix{}suffix", block("new")));
    }

    #[test]
    fn insert_and_replace_are_idempotent_with_terminal_newline() {
        for ending in ["", "\n", "\r\n"] {
            let block = format!("{}{ending}", block("new"));
            let inserted = upsert("description\n", &block).unwrap();
            assert_eq!(upsert(&inserted, &block).unwrap(), inserted);
            let replaced = upsert(&format!("before\n{}\nafter", self::block("old")), &block).unwrap();
            assert_eq!(upsert(&replaced, &block).unwrap(), replaced);
        }
    }

    #[test]
    fn refuses_unbalanced_reversed_or_duplicate_body_markers() {
        let valid = block("new");
        for body in [START.to_owned(), END.to_owned(), format!("{END}{START}"), format!("{START}{START}{END}"), format!("{START}{END}{END}"), format!("{valid}\n{valid}")] {
            assert!(upsert(&body, &valid).is_err(), "accepted {body:?}");
        }
    }

    #[test]
    fn refuses_invalid_blocks() {
        for invalid in ["".to_owned(), "plain text".to_owned(), START.to_owned(), END.to_owned(), format!("{END}{START}"), format!("{START}{START}{END}"), format!("{START}{END}{END}"), format!("outside{}", block("new")), format!("{}outside", block("new")), format!("{}\n\n", block("new"))] {
            assert!(upsert("description", &invalid).is_err(), "accepted {invalid:?}");
        }
    }
}
