//! Server-owned hosted scope. Clients/tracker adapters never choose authority,
//! identity or grants. JWT cryptographic verification belongs to the gateway;
//! this module implements the deterministic scope/capability intersection.
use crate::{Result, nonempty, refuse};
use serde::{Deserialize, Serialize};

pub const ACCESS_ISSUER: &str = "https://misty-step-pantry.cloudflareaccess.com";
pub const CANARY_ACCOUNT: &str = "b069014f6a46558ea9146fb6c4ff8f6c";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AuthorityBinding {
    pub instance: String,
    pub namespace: String,
    pub account_id: String,
    pub project_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GatewayAction {
    Read,
    Intake,
    Steer,
    Hold,
    Cancel,
    Metadata,
    Claim,
    NativeFacts,
    Proof,
    Archive,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PrincipalGrant {
    // Exactly one server-owned selector. Existing user JSON remains unchanged;
    // service_client_id matches SIGNED common_name, never a header/email/user sub.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub user_sub: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub service_client_id: Option<String>,
    pub actor_id: String,
    pub binding: AuthorityBinding,
    pub actions: Vec<GatewayAction>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AccessPolicy {
    pub issuer: String,
    pub audience: String,
    pub binding: AuthorityBinding,
    pub grants: Vec<PrincipalGrant>,
    pub native_enabled: bool,
}
// Claims are untrusted until the gateway verifies their RS256 signature. Parsing
// them, a matching audience, or an issuer string is not authentication.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessClaims {
    pub iss: String,
    pub aud: AccessAudience,
    pub sub: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub common_name: Option<String>,
    #[serde(rename = "type")]
    pub token_type: String,
    pub exp: u64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub nbf: Option<u64>,
    pub iat: u64,
}
// Actual verified service JWT has a scalar AUD; official docs also show arrays.
// Existing user shape remains array-only. Neither form implies an action grant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AccessAudience {
    One(String),
    Many(Vec<String>),
}
// Absence is different from a supplied null/malformed value. Service JWT may
// omit nbf, but a supplied time/identity claim must keep its original type.
fn present<'de, D, T>(d: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Principal<'a> {
    UserSub(&'a str),
    ServiceClientId(&'a str),
}
fn selector<'a>(sub: &'a str, client: Option<&'a str>) -> Option<Principal<'a>> {
    match (sub, client) {
        ("", Some(id)) if !id.trim().is_empty() => Some(Principal::ServiceClientId(id)),
        (id, None) if !id.trim().is_empty() => Some(Principal::UserSub(id)),
        _ => None,
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AttributedAuthority {
    pub binding: AuthorityBinding,
    pub actor_id: String,
}
impl AccessPolicy {
    pub fn validate(&self) -> Result<()> {
        if self.issuer != ACCESS_ISSUER || self.binding.account_id != CANARY_ACCOUNT {
            return refuse(
                "auth_config",
                "canary issuer/account must match the named owned scope",
            );
        }
        nonempty(&self.audience)?;
        for s in [
            &self.binding.instance,
            &self.binding.namespace,
            &self.binding.project_id,
        ] {
            nonempty(s)?;
        }
        let mut subjects = std::collections::BTreeSet::new();
        for grant in &self.grants {
            let principal = selector(&grant.user_sub, grant.service_client_id.as_deref())
                .ok_or_else(|| crate::Refusal {
                    code: "auth_config".into(),
                    message: "grant needs exactly one user sub or service client ID".into(),
                })?;
            nonempty(&grant.actor_id)?;
            if grant.binding != self.binding || !subjects.insert(principal) {
                return refuse(
                    "auth_config",
                    "grants must be unique and bind the server's exact authority",
                );
            }
        }
        Ok(())
    }
    /// Call only AFTER cryptographic signature verification at the gateway.
    pub fn authorize_verified(
        &self,
        claims: &AccessClaims,
        requested: &AuthorityBinding,
        action: GatewayAction,
        now: u64,
    ) -> Result<AttributedAuthority> {
        self.validate()?;
        let principal =
            selector(&claims.sub, claims.common_name.as_deref()).ok_or_else(|| crate::Refusal {
                code: "auth_invalid".into(),
                message: "unknown or mixed Access principal shape".into(),
            })?;
        let service = matches!(principal, Principal::ServiceClientId(_));
        let audience_matches = match &claims.aud {
            AccessAudience::One(aud) => service && aud == &self.audience,
            AccessAudience::Many(aud) => aud.contains(&self.audience),
        };
        // Only the observed service shape may omit nbf; signed iat still bounds
        // its start. Users retain the original mandatory not-before contract.
        let nbf = claims.nbf.or_else(|| service.then_some(claims.iat));
        if claims.iss != self.issuer
            || !audience_matches
            || claims.token_type != "app"
            || claims.exp <= now
            || nbf.is_none_or(|nbf| nbf > now || nbf > claims.exp)
            || claims.iat > now
            || claims.iat > claims.exp
        {
            return refuse("auth_invalid", "issuer/audience/type/time binding refused");
        }
        if requested != &self.binding {
            return refuse(
                "authority_refused",
                "account/project/instance/namespace is not this authority",
            );
        }
        let grant = self
            .grants
            .iter()
            .find(|g| selector(&g.user_sub, g.service_client_id.as_deref()) == Some(principal))
            .ok_or_else(|| crate::Refusal {
                code: "principal_refused".into(),
                message: "verified principal has no server-owned grant".into(),
            })?;
        if !grant.actions.contains(&action)
            || (!self.native_enabled
                && matches!(action, GatewayAction::Claim | GatewayAction::NativeFacts))
        {
            return refuse(
                "capability_refused",
                "action is not granted or native execution is disabled",
            );
        }
        Ok(AttributedAuthority {
            binding: self.binding.clone(),
            actor_id: grant.actor_id.clone(),
        })
    }
}
