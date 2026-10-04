//! In-memory protocol fixture, not installed-native/provider execution.
use anyhow::Result;
use std::{
    future::{poll_fn, Future},
    task::Poll,
};
use summon_pi_runtime::{record, Records};
use tokio::io::{AsyncWriteExt, BufReader};
#[tokio::test]
async fn split_frame_survives_losing_read_future() -> Result<()> {
    let (mut native_write, native_read) = tokio::io::duplex(128);
    let (mut control_write, control_read) = tokio::io::duplex(128);
    let mut native = Records::new(BufReader::new(native_read));
    let mut control = Records::new(BufReader::new(control_read));
    native_write.write_all(b"{\"type\":\"agent_").await?;
    control_write.write_all(b"{\"cancel\":").await?;
    {
        let mut first = Box::pin(record(&mut native));
        poll_fn(|cx| {
            assert!(first.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
    } // exactly the losing select branch's cancellation after consuming bytes
    {
        let mut first = Box::pin(record(&mut control));
        poll_fn(|cx| {
            assert!(first.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
    }
    native_write.write_all(b"settled\"}\n").await?;
    control_write
        .write_all(b"{\"cancel_id\":\"cancel-1\"}}\n")
        .await?;
    let native = record(&mut native).await?;
    let control = record(&mut control).await?;
    assert_eq!(native.unwrap()["type"], "agent_settled");
    assert_eq!(control.unwrap()["cancel"]["cancel_id"], "cancel-1");
    Ok(())
}
#[tokio::test]
async fn lf_utf8_eof_and_frame_bound_fail_closed() -> Result<()> {
    for bytes in [
        b"{\"x\":1}\r\n".to_vec(),
        b"{\"x\":\"\xff\"}\n".to_vec(),
        b"{\"x\":1}".to_vec(),
        vec![b'x'; 1024 * 1024 + 1],
    ] {
        let (mut write, read) = tokio::io::duplex(bytes.len() + 1);
        write.write_all(&bytes).await?;
        drop(write);
        let mut stream = Records::new(BufReader::new(read));
        assert!(record(&mut stream).await.is_err());
        assert!(
            record(&mut stream).await.is_err(),
            "failed frame cannot resume parsing a truncated tail"
        );
    }
    let (mut write, read) = tokio::io::duplex(128);
    write
        .write_all("{\"text\":\"héllo\"}\n{\"order\":2}\n".as_bytes())
        .await?;
    drop(write);
    let mut stream = Records::new(BufReader::new(read));
    assert_eq!(record(&mut stream).await?.unwrap()["text"], "héllo");
    assert_eq!(record(&mut stream).await?.unwrap()["order"], 2);
    assert!(record(&mut stream).await?.is_none());
    Ok(())
}
