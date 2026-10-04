//! Deterministic authorization contracts only. These are not JWT signature,
//! live Access, native entitlement or hosted consumer evidence.
use summon_protocol::authority::*;

fn policy() -> AccessPolicy {
    let binding = AuthorityBinding {
        instance: "fresh-canary-instance".into(),
        namespace: "fresh-canary-namespace".into(),
        account_id: CANARY_ACCOUNT.into(),
        project_id: "owned-project".into(),
    };
    AccessPolicy {
        issuer: ACCESS_ISSUER.into(),
        audience: "fixture-only-not-an-allocated-AUD".into(),
        binding: binding.clone(),
        native_enabled: false,
        grants: vec![PrincipalGrant {
            user_sub: "fixture-user-stable-sub".into(),
            actor_id: "fixture-actor".into(),
            binding,
            actions: vec![
                GatewayAction::Read,
                GatewayAction::Steer,
                GatewayAction::Claim,
            ],
        }],
    }
}
fn claims() -> AccessClaims {
    AccessClaims {
        iss: ACCESS_ISSUER.into(),
        aud: vec!["fixture-only-not-an-allocated-AUD".into()],
        sub: "fixture-user-stable-sub".into(),
        token_type: "app".into(),
        exp: 200,
        nbf: 50,
        iat: 50,
    }
}
#[test]
fn server_scope_and_action_grants_are_not_token_audience_or_client_labels() {
    let p = policy();
    let c = claims();
    let actor = p
        .authorize_verified(&c, &p.binding, GatewayAction::Steer, 100)
        .unwrap();
    assert_eq!(actor.actor_id, "fixture-actor");
    assert_eq!(actor.binding, p.binding);
    assert_eq!(
        p.authorize_verified(&c, &p.binding, GatewayAction::Proof, 100)
            .unwrap_err()
            .code,
        "capability_refused"
    );
    assert_eq!(
        p.authorize_verified(&c, &p.binding, GatewayAction::Claim, 100)
            .unwrap_err()
            .code,
        "capability_refused"
    );
    let mut unknown = c.clone();
    unknown.sub = "request-asserted-actor".into();
    assert_eq!(
        p.authorize_verified(&unknown, &p.binding, GatewayAction::Read, 100)
            .unwrap_err()
            .code,
        "principal_refused"
    );
    for field in ["account", "project", "instance", "namespace"] {
        let mut wrong = p.binding.clone();
        match field {
            "account" => wrong.account_id = "other-account".into(),
            "project" => wrong.project_id = "other-project".into(),
            "instance" => wrong.instance = "local-same-run-id".into(),
            _ => wrong.namespace = "old-unsafe-restored-namespace".into(),
        }
        assert_eq!(
            p.authorize_verified(&c, &wrong, GatewayAction::Read, 100)
                .unwrap_err()
                .code,
            "authority_refused"
        );
    }
}
#[test]
fn unknown_service_shapes_invalid_times_and_configuration_fail_closed() {
    let p = policy();
    for case in [
        "issuer", "audience", "type", "expired", "nbf", "iat", "service",
    ] {
        let mut c = claims();
        match case {
            "issuer" => c.iss = "https://attacker.invalid".into(),
            "audience" => c.aud.clear(),
            "type" => c.token_type = "org".into(),
            "expired" => c.exp = 100,
            "nbf" => c.nbf = 101,
            "iat" => c.iat = 101,
            _ => c.sub.clear(),
        }
        assert!(
            p.authorize_verified(&c, &p.binding, GatewayAction::Read, 100)
                .is_err(),
            "{case}"
        );
    }
    let mut missing = p.clone();
    missing.audience.clear();
    assert!(missing.validate().is_err());
    let mut duplicate = p.clone();
    duplicate.grants.push(duplicate.grants[0].clone());
    assert!(duplicate.validate().is_err());
    let mut widened = p.clone();
    widened.grants[0].binding.project_id = "unowned".into();
    assert!(widened.validate().is_err());
}
