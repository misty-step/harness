//! Small, offline safety checks for diagrams embedded in recap Markdown.
use anyhow::{bail, Result};

/// Validate the supported Mermaid subset without invoking a renderer.
/// This checks framing and balanced delimiters, not Mermaid's full grammar.
pub fn validate(input: &str) -> Result<()> {
    if input.trim().is_empty() {
        bail!("Mermaid input is empty");
    }
    for (index, line) in input.lines().enumerate() {
        if line.contains("```")
            || line.contains("<!-- shippr:recap:start -->")
            || line.contains("<!-- shippr:recap:end -->")
        {
            bail!("Mermaid line {} contains a Markdown fence or recap marker", index + 1);
        }
    }
    let header = input.lines().next().unwrap().trim();
    let words: Vec<_> = header.split_whitespace().collect();
    let known = matches!(words.as_slice(), ["sequenceDiagram"] | ["stateDiagram-v2"])
        || matches!(words.as_slice(), ["flowchart" | "graph", "TD" | "LR" | "TB" | "RL" | "BT"]);
    if !known {
        bail!("unsupported Mermaid first line: expected flowchart/graph TD|LR|TB|RL|BT, sequenceDiagram, or stateDiagram-v2");
    }

    let mut brackets = Vec::new();
    let mut quote = None;
    let mut escaped = false;
    for (line_index, line) in input.lines().enumerate() {
        let chars: Vec<_> = line.chars().collect();
        for (index, &ch) in chars.iter().enumerate() {
            if let Some(delimiter) = quote {
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == delimiter {
                    quote = None;
                }
                continue;
            }
            // Mermaid comments may contain arbitrary punctuation.
            if ch == '%' && chars.get(index + 1) == Some(&'%') {
                break;
            }
            // Apostrophes in ordinary prose (Don't, user's) are not quotes.
            let apostrophe_in_word = ch == '\''
                && index > 0
                && chars[index - 1].is_alphanumeric();
            if ch == '"' || (ch == '\'' && !apostrophe_in_word) {
                quote = Some(ch);
            } else if matches!(ch, '(' | '[' | '{') {
                brackets.push(ch);
            } else if matches!(ch, ')' | ']' | '}') {
                let expected = match ch {
                    ')' => '(',
                    ']' => '[',
                    '}' => '{',
                    _ => unreachable!(),
                };
                if brackets.pop() != Some(expected) {
                    bail!("unbalanced Mermaid brackets on line {}", line_index + 1);
                }
            }
        }
        // A backslash at the end of a line does not escape the next line.
        escaped = false;
    }
    if quote.is_some() {
        bail!("unbalanced Mermaid quotes");
    }
    if !brackets.is_empty() {
        bail!("unbalanced Mermaid brackets");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn accepts_all_supported_headers() {
        for family in ["flowchart", "graph"] {
            for direction in ["TD", "LR", "TB", "RL", "BT"] {
                validate(&format!("{family} {direction}\nA[Start] --> B{{Done?}}\nB --> C(End)"))
                    .unwrap();
            }
        }
        validate("sequenceDiagram\nAlice->>Bob: Hello").unwrap();
        validate("stateDiagram-v2\n[*] --> Ready\nstate Group {\nReady --> Done\n}").unwrap();
    }

    #[test]
    fn accepts_quotes_escaped_quotes_and_apostrophes() {
        validate("flowchart TD\nA[\"Don't close ] here\\\" yet\"] --> B['Ready']").unwrap();
        validate("graph LR\nA[Don't stop] --> B[Users' choice]").unwrap();
        validate("graph TD\n%% unmatched [ and \" in comments\nA --> B").unwrap();
        validate("flowchart TD\r\nA[Start] --> B[End]\r\n").unwrap();
    }

    #[test]
    fn rejects_empty_inputs() {
        for input in ["", " ", "\n\t\r\n"] {
            assert!(validate(input).unwrap_err().to_string().contains("empty"));
        }
    }

    #[test]
    fn rejects_unknown_or_malformed_headers() {
        for input in ["pie\n\"A\": 1", "flowchart", "graph XX", "flowchart td", "sequenceDiagram extra", "stateDiagram", "\nflowchart TD", "flowchart TD extra"] {
            assert!(validate(input).is_err(), "accepted {input:?}");
        }
    }

    #[test]
    fn rejects_unbalanced_or_misnested_brackets() {
        for diagram in ["A[Start", "A(Start", "A{Start", "A]", "A)", "A}", "A[(])"] {
            let error = validate(&format!("flowchart TD\n{diagram}")).unwrap_err();
            assert!(error.to_string().contains("brackets"));
        }
    }

    #[test]
    fn rejects_unbalanced_quotes() {
        for diagram in ["A[\"Start]", "A['Start]", "A[\"Start\\\"]"] {
            let error = validate(&format!("flowchart TD\n{diagram}")).unwrap_err();
            assert!(error.to_string().contains("quotes"));
        }
    }

    #[test]
    fn rejects_fences_and_markers_even_in_comments_or_quotes() {
        for unsafe_line in ["```", "%% ```mermaid", "A[\"```\"]", "<!-- shippr:recap:start -->", "%% <!-- shippr:recap:end -->"] {
            let error = validate(&format!("graph TD\n{unsafe_line}")).unwrap_err();
            assert!(error.to_string().contains("line 2"));
        }
    }
}
