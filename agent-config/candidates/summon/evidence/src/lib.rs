//! Native source selection for the shared view/packet consumer. Shared graph,
//! freshness and PacketManifest types belong ONLY to factory/protocol.
pub mod archive;
pub mod native;
pub mod retention;
pub mod source;

pub fn refused(refusal: summon_protocol::Refusal) -> anyhow::Error {
    anyhow::anyhow!("{}: {}", refusal.code, refusal.message)
}
