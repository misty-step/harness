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
    // User sub is the stable Access identity, not email, client or device label.
    // Service-token selectors are not implemented until their shape is proved.
    pub user_sub: String,
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
    pub aud: Vec<String>,
    pub sub: String,
    #[serde(rename = "type")]
    pub token_type: String,
    pub exp: u64,
    pub nbf: u64,
    pub iat: u64,
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
            nonempty(&grant.user_sub)?;
            nonempty(&grant.actor_id)?;
            if grant.binding != self.binding || !subjects.insert(&grant.user_sub) {
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
        if claims.iss != self.issuer
            || !claims.aud.contains(&self.audience)
            || claims.token_type != "app"
            || claims.exp <= now
            || claims.nbf > now
            || claims.iat > now
            || claims.iat > claims.exp
            || claims.nbf > claims.exp
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
            .find(|g| g.user_sub == claims.sub)
            .ok_or_else(|| crate::Refusal {
                code: "principal_refused".into(),
                message: "verified user has no server-owned grant".into(),
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
