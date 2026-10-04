//! Cloudflare Access signature validation. This is the ONLY hosted identity
//! entry point; callers never supply an actor or a JWKS URL. Pure permission
//! checks in summon-protocol run only after WebCrypto verifies RS256.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use js_sys::{Array, Reflect, Uint8Array, futures::JsFuture};
use serde::Deserialize;
use serde_json::Value;
use summon_protocol::authority::*;
use wasm_bindgen::{JsCast, JsValue};
use worker::{Env, Fetch, Request, RequestInit, Response, send::SendFuture};

type Result<T> = std::result::Result<T, &'static str>;
#[derive(Deserialize)]
struct Header {
    alg: String,
    kid: String,
    typ: String,
    #[serde(default)]
    crit: Option<Value>,
}
#[derive(Debug, Clone)]
pub struct GatewayIdentity {
    pub authority: AttributedAuthority,
}
fn variable(env: &Env, name: &str) -> Result<String> {
    env.var(name)
        .map(|v| v.to_string())
        .map_err(|_| "auth_unconfigured")
}

pub async fn authenticate(
    req: &Request,
    env: &Env,
    action: GatewayAction,
) -> Result<GatewayIdentity> {
    let policy: AccessPolicy =
        serde_json::from_str(&variable(env, "FACTORY_AUTH_POLICY")?).map_err(|_| "auth_config")?;
    policy.validate().map_err(|_| "auth_config")?;
    let token = req
        .headers()
        .get("cf-access-jwt-assertion")
        .map_err(|_| "auth_invalid")?
        .ok_or("auth_missing")?;
    if token.len() > 16384 {
        return Err("auth_invalid");
    }
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 {
        return Err("auth_invalid");
    }
    let decode = |s| URL_SAFE_NO_PAD.decode(s).map_err(|_| "auth_invalid");
    let header: Header = serde_json::from_slice(&decode(parts[0])?).map_err(|_| "auth_invalid")?;
    if header.alg != "RS256"
        || header.typ != "JWT"
        || header.crit.is_some()
        || header.kid.is_empty()
        || header.kid.len() > 128
        || header.kid.chars().any(char::is_control)
    {
        return Err("auth_invalid");
    }
    let claims: AccessClaims =
        serde_json::from_slice(&decode(parts[1])?).map_err(|_| "auth_invalid")?;
    let signature = decode(parts[2])?;
    let mode = variable(env, "FACTORY_MODE")?;
    let jwks: Value = match mode.as_str() {
        "fixture" => {
            // Fixture keys are never accepted by hosted mode, including loopback.
            let url = req.url().map_err(|_| "auth_config")?;
            if !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")) {
                return Err("auth_config");
            }
            serde_json::from_str(&variable(env, "FACTORY_FIXTURE_JWKS")?)
                .map_err(|_| "auth_config")?
        }
        "hosted" => {
            if env.var("FACTORY_FIXTURE_JWKS").is_ok() {
                return Err("auth_config");
            }
            // Deliberately ignore unverified claims.iss, jku and x5u. Only the
            // server-pinned issuer chooses the network destination; no redirects.
            let mut init = RequestInit::new();
            init.with_redirect(worker::RequestRedirect::Manual);
            let request =
                Request::new_with_init(&format!("{ACCESS_ISSUER}/cdn-cgi/access/certs"), &init)
                    .map_err(|_| "auth_unavailable")?;
            let mut response: Response = Fetch::Request(request)
                .send()
                .await
                .map_err(|_| "auth_unavailable")?;
            if response.status_code() != 200 {
                return Err("auth_unavailable");
            }
            let bytes = response.bytes().await.map_err(|_| "auth_unavailable")?;
            if bytes.len() > 65536 {
                return Err("auth_unavailable");
            }
            serde_json::from_slice(&bytes).map_err(|_| "auth_unavailable")?
        }
        _ => return Err("auth_config"),
    };
    let keys = jwks["keys"].as_array().ok_or("auth_unavailable")?;
    if keys.len() > 16 {
        return Err("auth_unavailable");
    }
    let matches: Vec<_> = keys
        .iter()
        .filter(|key| key["kid"].as_str() == Some(&header.kid))
        .collect();
    if matches.len() != 1 {
        return Err("auth_invalid");
    }
    let key = matches[0];
    if key["kty"] != "RSA" || key["alg"] != "RS256" || key["use"] != "sig" || key.get("d").is_some()
    {
        return Err("auth_invalid");
    }
    let modulus = decode(key["n"].as_str().ok_or("auth_invalid")?)?;
    if !(256..=512).contains(&modulus.len()) {
        return Err("auth_invalid");
    }
    let crypto: web_sys::Crypto = Reflect::get(&js_sys::global(), &JsValue::from_str("crypto"))
        .map_err(|_| "auth_unavailable")?
        .dyn_into()
        .map_err(|_| "auth_unavailable")?;
    let subtle = crypto.subtle();
    let jwk: js_sys::Object = js_sys::JSON::parse(&key.to_string())
        .map_err(|_| "auth_invalid")?
        .dyn_into()
        .map_err(|_| "auth_invalid")?;
    let algorithm: js_sys::Object =
        js_sys::JSON::parse(r#"{"name":"RSASSA-PKCS1-v1_5","hash":"SHA-256"}"#)
            .map_err(|_| "auth_unavailable")?
            .dyn_into()
            .map_err(|_| "auth_unavailable")?;
    let usages = Array::new();
    usages.push(&JsValue::from_str("verify"));
    let imported = subtle
        .import_key_with_object("jwk", &jwk, &algorithm, false, &usages)
        .map_err(|_| "auth_invalid")?;
    let crypto_key: web_sys::CryptoKey = SendFuture::new(JsFuture::from(imported))
        .await
        .map_err(|_| "auth_invalid")?
        .dyn_into()
        .map_err(|_| "auth_invalid")?;
    let signed = format!("{}.{}", parts[0], parts[1]);
    let promise = subtle
        .verify_with_str_and_buffer_source_and_buffer_source(
            "RSASSA-PKCS1-v1_5",
            &crypto_key,
            &Uint8Array::from(signature.as_slice()),
            &Uint8Array::from(signed.as_bytes()),
        )
        .map_err(|_| "auth_invalid")?;
    if SendFuture::new(JsFuture::from(promise))
        .await
        .map_err(|_| "auth_invalid")?
        .as_bool()
        != Some(true)
    {
        return Err("auth_invalid");
    }
    let requested: AuthorityBinding = serde_json::from_str(
        &req.headers()
            .get("x-summon-authority")
            .map_err(|_| "authority_refused")?
            .ok_or("authority_refused")?,
    )
    .map_err(|_| "authority_refused")?;
    let authority = policy
        .authorize_verified(
            &claims,
            &requested,
            action,
            worker::Date::now().as_millis() / 1000,
        )
        .map_err(|e| match e.code.as_str() {
            "authority_refused" => "authority_refused",
            "principal_refused" => "principal_refused",
            "capability_refused" => "capability_refused",
            _ => "auth_invalid",
        })?;
    Ok(GatewayIdentity { authority })
}
