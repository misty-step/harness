// Standalone Linux shim: rustc --edition=2024 -O omp-browser-helper.rs -o omp-browser-helper.
// Registration needs systemd's PIDFDs transient-scope property (v261); never substitute PIDs.

use std::env;
use std::ffi::{CStr, CString, OsStr, OsString, c_char, c_int, c_uint, c_ushort, c_void};
use std::fs::{self, File, Metadata};
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::time::{Duration, Instant};

const HANDOFF_TIMEOUT: Duration = Duration::from_secs(15);
const METHOD_TIMEOUT_USEC: u64 = 5_000_000;
const REPLY_LIMIT: usize = 128;
const AF_UNIX: c_int = 1;
const SOCK_STREAM: c_int = 1;
const SOCK_CLOEXEC: c_int = 0o2000000;
const SOL_SOCKET: c_int = 1;
const SO_PEERCRED: c_int = 17;
const F_DUPFD_CLOEXEC: c_int = 1030;

#[repr(C)]
struct UnixAddress {
    family: c_ushort,
    path: [c_char; 108],
}

#[repr(C)]
struct PeerCredentials {
    _pid: c_int,
    uid: c_uint,
    _gid: c_uint,
}

unsafe extern "C" {
    fn getuid() -> c_uint;
    fn socket(domain: c_int, kind: c_int, protocol: c_int) -> c_int;
    fn connect(fd: c_int, address: *const c_void, length: c_uint) -> c_int;
    fn getsockopt(fd: c_int, level: c_int, option: c_int, value: *mut c_void, length: *mut c_uint) -> c_int;
    fn fcntl(fd: c_int, operation: c_int, ...) -> c_int;
}

#[repr(C)]
struct SdBus {
    _opaque: [u8; 0],
}

#[repr(C)]
struct SdBusMessage {
    _opaque: [u8; 0],
}

#[repr(C)]
struct SdBusError {
    name: *const c_char,
    message: *const c_char,
    need_free: c_int,
}

// Link the installed runtime SONAME directly: no libsystemd development symlink or Cargo.
#[link(name = "libsystemd.so.0", kind = "dylib", modifiers = "+verbatim")]
unsafe extern "C" {
    fn sd_bus_open_user(bus: *mut *mut SdBus) -> c_int;
    fn sd_bus_close_unref(bus: *mut SdBus) -> *mut SdBus;
    fn sd_bus_set_method_call_timeout(bus: *mut SdBus, usec: u64) -> c_int;
    fn sd_bus_message_new_method_call(bus: *mut SdBus, message: *mut *mut SdBusMessage, destination: *const c_char, path: *const c_char, interface: *const c_char, member: *const c_char) -> c_int;
    fn sd_bus_message_unref(message: *mut SdBusMessage) -> *mut SdBusMessage;
    fn sd_bus_message_set_allow_interactive_authorization(message: *mut SdBusMessage, allow: c_int) -> c_int;
    fn sd_bus_message_append_basic(message: *mut SdBusMessage, kind: c_char, value: *const c_void) -> c_int;
    fn sd_bus_message_open_container(message: *mut SdBusMessage, kind: c_char, contents: *const c_char) -> c_int;
    fn sd_bus_message_close_container(message: *mut SdBusMessage) -> c_int;
    fn sd_bus_call(bus: *mut SdBus, message: *mut SdBusMessage, usec: u64, error: *mut SdBusError, reply: *mut *mut SdBusMessage) -> c_int;
    fn sd_bus_message_read_basic(message: *mut SdBusMessage, kind: c_char, value: *mut c_void) -> c_int;
    fn sd_bus_message_at_end(message: *mut SdBusMessage, complete: c_int) -> c_int;
    fn sd_bus_error_free(error: *mut SdBusError);
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn bus_result(result: c_int, action: &'static str) -> io::Result<()> {
    if result < 0 {
        Err(io::Error::other(format!("{action}: {}", io::Error::from_raw_os_error(-result))))
    } else {
        Ok(())
    }
}

struct Bus(*mut SdBus);

impl Bus {
    fn user() -> io::Result<Self> {
        let mut bus = Self(std::ptr::null_mut());
        // SAFETY: libsystemd initializes this owned pointer; Drop also covers partial failure.
        bus_result(unsafe { sd_bus_open_user(&mut bus.0) }, "open user bus")?;
        if bus.0.is_null() {
            return Err(invalid("user bus returned no connection"));
        }
        bus_result(unsafe { sd_bus_set_method_call_timeout(bus.0, METHOD_TIMEOUT_USEC) }, "bound bus timeout")?;
        Ok(bus)
    }

    fn call(&self, message: &Message) -> io::Result<Message> {
        let mut reply = Message(std::ptr::null_mut());
        let mut error = BusError(SdBusError {
            name: std::ptr::null(),
            message: std::ptr::null(),
            need_free: 0,
        });
        // SAFETY: all objects are live, exclusively used here, and the error starts SD_BUS_ERROR_NULL.
        let result = unsafe { sd_bus_call(self.0, message.0, METHOD_TIMEOUT_USEC, &mut error.0, &mut reply.0) };
        if result < 0 {
            let detail = if error.0.message.is_null() {
                None
            } else {
                // SAFETY: this NUL-terminated message remains owned by error until its Drop.
                Some(unsafe { CStr::from_ptr(error.0.message) }.to_string_lossy())
            };
            return Err(io::Error::other(format!("StartTransientUnit: {}{}{}",
                io::Error::from_raw_os_error(-result),
                if detail.is_some() { ": " } else { "" }, detail.as_deref().unwrap_or(""))));
        }
        if reply.0.is_null() {
            return Err(invalid("StartTransientUnit returned no reply"));
        }
        Ok(reply)
    }
}

impl Drop for Bus {
    fn drop(&mut self) {
        // SAFETY: the pointer is NULL or our single owned connection reference.
        unsafe { sd_bus_close_unref(self.0) };
    }
}

struct BusError(SdBusError);

impl Drop for BusError {
    fn drop(&mut self) {
        // SAFETY: this is the initialized error populated only by sd_bus_call.
        unsafe { sd_bus_error_free(&mut self.0) };
    }
}

struct Message(*mut SdBusMessage);

impl Message {
    fn start_scope(bus: &Bus) -> io::Result<Self> {
        let mut message = Self(std::ptr::null_mut());
        // SAFETY: libsystemd writes an owned message pointer and copies these static strings.
        bus_result(unsafe { sd_bus_message_new_method_call(bus.0, &mut message.0,
            c"org.freedesktop.systemd1".as_ptr(), c"/org/freedesktop/systemd1".as_ptr(),
            c"org.freedesktop.systemd1.Manager".as_ptr(), c"StartTransientUnit".as_ptr()) }, "create scope request")?;
        if message.0.is_null() {
            return Err(invalid("scope request returned no message"));
        }
        bus_result(unsafe { sd_bus_message_set_allow_interactive_authorization(message.0, 0) }, "disable interactive authorization")?;
        Ok(message)
    }

    fn string(&mut self, value: &CStr) -> io::Result<()> {
        // SAFETY: append_basic(s) takes the string itself, not a char**; it copies it.
        bus_result(unsafe { sd_bus_message_append_basic(self.0, b's' as c_char, value.as_ptr().cast()) }, "append bus string")
    }

    fn boolean(&mut self, value: bool) -> io::Result<()> {
        let value: c_int = i32::from(value);
        // SAFETY: the D-Bus boolean ABI requires a C int, not Rust's one-byte bool.
        bus_result(unsafe { sd_bus_message_append_basic(self.0, b'b' as c_char, (&value as *const c_int).cast()) }, "append bus boolean")
    }

    fn uint64(&mut self, value: u64) -> io::Result<()> {
        // SAFETY: D-Bus t consumes a pointer to this live uint64_t and copies it.
        bus_result(unsafe { sd_bus_message_append_basic(self.0, b't' as c_char, (&value as *const u64).cast()) }, "append bus limit")
    }

    fn pidfd(&mut self, value: &OwnedFd) -> io::Result<()> {
        let fd = value.as_raw_fd();
        // SAFETY: h consumes int* and duplicates the FD; our owned immutable pidfd remains live.
        bus_result(unsafe { sd_bus_message_append_basic(self.0, b'h' as c_char, (&fd as *const c_int).cast()) }, "append PIDFD")
    }

    fn open(&mut self, kind: u8, contents: &CStr) -> io::Result<()> {
        // SAFETY: the message is live and libsystemd validates the container signature.
        bus_result(unsafe { sd_bus_message_open_container(self.0, kind as c_char, contents.as_ptr()) }, "open bus container")
    }

    fn close(&mut self) -> io::Result<()> {
        // SAFETY: callers close each successfully opened container in nesting order.
        bus_result(unsafe { sd_bus_message_close_container(self.0) }, "close bus container")
    }

    fn property(&mut self, name: &CStr, signature: &CStr, append: impl FnOnce(&mut Self) -> io::Result<()>) -> io::Result<()> {
        self.open(b'r', c"sv")?;
        self.string(name)?;
        self.open(b'v', signature)?;
        append(self)?;
        self.close()?;
        self.close()
    }

    fn require_job_reply(&self) -> io::Result<()> {
        let mut job: *const c_char = std::ptr::null();
        // SAFETY: read_basic(o) returns a borrowed C string kept alive by this message.
        let result = unsafe { sd_bus_message_read_basic(self.0, b'o' as c_char, (&mut job as *mut *const c_char).cast()) };
        bus_result(result, "read scope job")?;
        if result == 0 || job.is_null() {
            return Err(invalid("scope reply has no job path"));
        }
        // SAFETY: no containers have been entered; complete=1 requires the whole reply to end.
        let end = unsafe { sd_bus_message_at_end(self.0, 1) };
        bus_result(end, "validate scope reply")?;
        if end == 0 {
            return Err(invalid("scope reply contains extra fields"));
        }
        Ok(())
    }
}

impl Drop for Message {
    fn drop(&mut self) {
        // SAFETY: the pointer is NULL or our single owned message reference.
        unsafe { sd_bus_message_unref(self.0) };
    }
}

fn valid_scope(unit: &str) -> bool {
    unit.strip_prefix("omp-engineer-")
        .and_then(|value| value.strip_suffix(".scope"))
        .is_some_and(|token| token.len() == 24 && token.bytes().all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value)))
}

fn decimal(value: &str) -> io::Result<u64> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(invalid("expected decimal integer"));
    }
    value.parse().map_err(|_| invalid("decimal integer exceeds uint64"))
}

fn finite_bytes(value: &str) -> io::Result<u64> {
    let bytes = decimal(value)?;
    if bytes == 0 || bytes == u64::MAX {
        return Err(invalid("memory cap must be positive and finite"));
    }
    Ok(bytes)
}

fn argument(args: &mut impl Iterator<Item = OsString>) -> io::Result<OsString> {
    args.next().ok_or_else(|| invalid("usage: --register PIDFD UNIT OWNER_UNIT BYTES"))
}

fn register(mut args: impl Iterator<Item = OsString>) -> io::Result<()> {
    let fd = argument(&mut args)?;
    let unit = argument(&mut args)?;
    let owner = argument(&mut args)?;
    let bytes = argument(&mut args)?;
    if args.next().is_some() {
        return Err(invalid("usage: --register PIDFD UNIT OWNER_UNIT BYTES"));
    }
    let fd = decimal(fd.to_str().ok_or_else(|| invalid("invalid PIDFD argument"))?)?;
    let fd = c_int::try_from(fd).map_err(|_| invalid("invalid PIDFD descriptor"))?;
    if fd < 3 {
        return Err(invalid("PIDFD must be an inherited non-stdio descriptor"));
    }
    let unit = unit.to_str().ok_or_else(|| invalid("invalid scope unit"))?;
    let owner = owner.to_str().ok_or_else(|| invalid("invalid owner unit"))?;
    if !valid_scope(unit) || !valid_scope(owner) || unit == owner {
        return Err(invalid("helper and owner must be distinct owned scope units"));
    }
    let bytes = finite_bytes(bytes.to_str().ok_or_else(|| invalid("invalid memory cap"))?)?;
    // Duplicate before opening sd-bus: a closed supplied fd must not become a new bus fd.
    // SAFETY: F_DUPFD_CLOEXEC takes an int minimum; failure leaves no descriptor to own.
    let duplicate = unsafe { fcntl(fd, F_DUPFD_CLOEXEC, 3 as c_int) };
    if duplicate < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: this successful duplicate is exclusively ours. systemd validates that it is a pidfd.
    let pidfd = unsafe { OwnedFd::from_raw_fd(duplicate) };
    let unit = CString::new(unit).map_err(|_| invalid("invalid scope unit"))?;
    let description = CString::new(format!("Bounded OMP Chromium helper; owner={owner}"))
        .map_err(|_| invalid("invalid owner description"))?;
    let bus = Bus::user()?;
    let mut message = Message::start_scope(&bus)?;
    message.string(&unit)?;
    message.string(c"fail")?;
    message.open(b'a', c"(sv)")?;
    message.property(c"Slice", c"s", |m| m.string(c"omp.slice"))?;
    message.property(c"Description", c"s", |m| m.string(&description))?;
    message.property(c"MemoryAccounting", c"b", |m| m.boolean(true))?;
    message.property(c"MemoryMax", c"t", |m| m.uint64(bytes))?;
    message.property(c"MemorySwapMax", c"t", |m| m.uint64(0))?;
    message.property(c"MemoryHigh", c"t", |m| m.uint64(u64::MAX))?;
    message.property(c"OOMPolicy", c"s", |m| m.string(c"kill"))?;
    message.property(c"CollectMode", c"s", |m| m.string(c"inactive-or-failed"))?;
    message.property(c"PIDFDs", c"ah", |m| {
        m.open(b'a', c"h")?;
        m.pidfd(&pidfd)?;
        m.close()
    })?;
    message.close()?;
    message.open(b'a', c"(sa(sv))")?;
    message.close()?;
    // A returned job is not proof of admission: the controller verifies actual state before EXEC.
    bus.call(&message)?.require_job_reply()
}

struct Admission<'a> {
    unit: &'a str,
    bytes: u64,
}

fn parse_reply(reply: &[u8]) -> io::Result<Admission<'_>> {
    if reply.len() > REPLY_LIMIT {
        return Err(invalid("admission reply exceeds 128 bytes"));
    }
    let text = std::str::from_utf8(reply).map_err(|_| invalid("admission reply is not UTF-8"))?;
    let text = text.strip_suffix('\n').ok_or_else(|| invalid("unterminated admission reply"))?;
    let text = text.strip_prefix("EXEC ").ok_or_else(|| invalid("browser was not admitted"))?;
    let (unit, bytes) = text.split_once(' ').ok_or_else(|| invalid("incomplete admission reply"))?;
    if !valid_scope(unit) {
        return Err(invalid("admission reply names an invalid scope"));
    }
    Ok(Admission { unit, bytes: finite_bytes(bytes)? })
}

fn read_text<'a>(path: impl AsRef<Path>, buffer: &'a mut [u8]) -> io::Result<&'a str> {
    let mut file = File::open(path)?;
    let mut length = 0;
    loop {
        let mut extra = [0; 1];
        let target = if length == buffer.len() { &mut extra[..] } else { &mut buffer[length..] };
        match file.read(target) {
            Ok(0) => break,
            Ok(_) if length == buffer.len() => return Err(invalid("cgroup state exceeds read bound")),
            Ok(count) => length += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    std::str::from_utf8(&buffer[..length]).map_err(|_| invalid("cgroup state is not UTF-8"))
}

fn unified_group(raw: &str) -> io::Result<&str> {
    let mut group = None;
    for line in raw.split_terminator('\n') {
        if let Some(path) = line.strip_prefix("0::") {
            if group.replace(path).is_some() {
                return Err(invalid("duplicate unified cgroup membership"));
            }
        }
    }
    group.ok_or_else(|| invalid("missing unified cgroup membership"))
}

fn fleet_path(uid: c_uint) -> String {
    format!("/user.slice/user-{uid}.slice/user@{uid}.service/omp.slice/")
}

fn owner_unit<'a>(raw: &'a str, fleet: &str) -> io::Result<&'a str> {
    let unit = unified_group(raw)?.strip_prefix(fleet).ok_or_else(|| invalid("browser shim is outside the owner fleet"))?;
    if !valid_scope(unit) {
        return Err(invalid("browser shim has no owned owner leaf"));
    }
    Ok(unit)
}

fn control_value(raw: &str) -> &str {
    raw.strip_suffix('\n').unwrap_or(raw)
}

fn validate_controls(bytes: u64, maximum: &str, swap: &str, high: &str, group: &str) -> io::Result<()> {
    if finite_bytes(control_value(maximum))? != bytes || control_value(swap) != "0" || control_value(high) != "max" || control_value(group) != "1" {
        return Err(invalid("browser scope does not have the admitted memory controls"));
    }
    Ok(())
}

fn verify_actual(admission: &Admission<'_>, owner: &str, fleet: &str) -> io::Result<()> {
    if admission.unit == owner {
        return Err(invalid("browser admission did not leave its owner leaf"));
    }
    let expected = format!("{fleet}{}", admission.unit);
    let mut membership = [0; 4096];
    if unified_group(read_text("/proc/self/cgroup", &mut membership)?)? != expected {
        return Err(invalid("browser shim is not in the admitted sibling scope"));
    }
    let directory = Path::new("/sys/fs/cgroup").join(expected.trim_start_matches('/'));
    let (mut maximum, mut swap, mut high, mut group) = ([0; 32], [0; 32], [0; 32], [0; 32]);
    validate_controls(admission.bytes,
        read_text(directory.join("memory.max"), &mut maximum)?,
        read_text(directory.join("memory.swap.max"), &mut swap)?,
        read_text(directory.join("memory.high"), &mut high)?,
        read_text(directory.join("memory.oom.group"), &mut group)?)
}

fn remaining(deadline: Instant) -> io::Result<Duration> {
    deadline.checked_duration_since(Instant::now()).filter(|value| !value.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "browser admission deadline expired"))
}

fn controller(uid: c_uint, deadline: Instant) -> io::Result<UnixStream> {
    let path = format!("/run/user/{uid}/omp-browser-helper.sock");
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_socket() || metadata.uid() != uid || metadata.mode() & 0o7777 != 0o600 {
        return Err(invalid("browser controller endpoint is not a private same-UID socket"));
    }
    let mut address = UnixAddress { family: AF_UNIX as c_ushort, path: [0; 108] };
    if path.len() >= address.path.len() {
        return Err(invalid("browser controller path exceeds Unix address limit"));
    }
    for (destination, byte) in address.path.iter_mut().zip(path.bytes()) {
        *destination = byte as c_char;
    }
    // SAFETY: these are Linux AF_UNIX/SOCK_STREAM constants; successful socket returns an owned fd.
    let fd = unsafe { socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: this new descriptor belongs exclusively to us, including failed-connect cleanup.
    let stream = UnixStream::from(unsafe { OwnedFd::from_raw_fd(fd) });
    // SO_SNDTIMEO also bounds Linux connect(), including a full listener backlog.
    stream.set_write_timeout(Some(remaining(deadline)?))?;
    stream.set_read_timeout(Some(remaining(deadline)?))?;
    let length = (std::mem::size_of::<c_ushort>() + path.len() + 1) as c_uint;
    // SAFETY: sockaddr_un is initialized, NUL-terminated and live for the supplied length.
    if unsafe { connect(stream.as_raw_fd(), (&address as *const UnixAddress).cast(), length) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut credentials = PeerCredentials { _pid: 0, uid: 0, _gid: 0 };
    let mut length = std::mem::size_of::<PeerCredentials>() as c_uint;
    // SAFETY: SO_PEERCRED writes Linux struct ucred into a correctly sized C-layout object.
    if unsafe { getsockopt(stream.as_raw_fd(), SOL_SOCKET, SO_PEERCRED,
        (&mut credentials as *mut PeerCredentials).cast(), &mut length) } < 0 {
        return Err(io::Error::last_os_error());
    }
    if length as usize != std::mem::size_of::<PeerCredentials>() || credentials.uid != uid {
        return Err(invalid("browser controller peer is not the same UID"));
    }
    Ok(stream)
}

fn request_permission(stream: &mut UnixStream, deadline: Instant, reply: &mut [u8; REPLY_LIMIT]) -> io::Result<usize> {
    let mut request = &b"CHROMIUM\n"[..];
    while !request.is_empty() {
        stream.set_write_timeout(Some(remaining(deadline)?))?;
        match stream.write(request) {
            Ok(0) => return Err(io::Error::new(io::ErrorKind::WriteZero, "browser controller disconnected")),
            Ok(count) => request = &request[count..],
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    let mut length = 0;
    loop {
        if length == reply.len() {
            return Err(invalid("admission reply exceeds 128 bytes"));
        }
        stream.set_read_timeout(Some(remaining(deadline)?))?;
        match stream.read(&mut reply[length..]) {
            Ok(0) => return Err(invalid("browser controller closed without a complete reply")),
            Ok(count) => {
                length += count;
                if let Some(end) = reply[..length].iter().position(|byte| *byte == b'\n') {
                    if end + 1 != length {
                        return Err(invalid("admission reply has trailing data"));
                    }
                    return Ok(length);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
}

fn resolve_browser(executable: &OsStr) -> io::Result<(PathBuf, Metadata)> {
    if executable.is_empty() {
        return Err(invalid("OMP_CHROMIUM_EXECUTABLE is empty"));
    }
    let path = Path::new(executable);
    if executable.as_bytes().contains(&b'/') {
        let path = if path.is_absolute() { path.to_owned() } else { env::current_dir()?.join(path) };
        let metadata = fs::metadata(&path)?;
        return Ok((path, metadata));
    }
    let search = env::var_os("PATH").ok_or_else(|| invalid("browser executable requires PATH"))?;
    let cwd = env::current_dir()?;
    for directory in env::split_paths(&search) {
        let candidate = if directory.is_absolute() { directory.join(path) } else { cwd.join(directory).join(path) };
        if let Ok(metadata) = fs::metadata(&candidate) {
            if metadata.is_file() && metadata.mode() & 0o111 != 0 {
                return Ok((candidate, metadata));
            }
        }
    }
    Err(io::Error::new(io::ErrorKind::NotFound, "browser executable was not found on PATH"))
}

fn browser(args: impl Iterator<Item = OsString>) -> io::Result<()> {
    // SAFETY: getuid has no preconditions and cannot fail on Linux.
    let uid = unsafe { getuid() };
    let fleet = fleet_path(uid);
    let mut membership = [0; 4096];
    let owner = owner_unit(read_text("/proc/self/cgroup", &mut membership)?, &fleet)?;
    let executable = env::var_os("OMP_CHROMIUM_EXECUTABLE").unwrap_or_else(|| OsString::from("/usr/bin/chromium"));
    let (path, target) = resolve_browser(&executable)?;
    let own = fs::metadata("/proc/self/exe")?;
    if (own.dev(), own.ino()) == (target.dev(), target.ino()) {
        return Err(invalid("OMP_CHROMIUM_EXECUTABLE points back to the browser shim"));
    }
    let deadline = Instant::now() + HANDOFF_TIMEOUT;
    let mut connection = controller(uid, deadline)?;
    let mut reply = [0; REPLY_LIMIT];
    let length = request_permission(&mut connection, deadline, &mut reply)?;
    let admission = parse_reply(&reply[..length])?;
    verify_actual(&admission, owner, &fleet)?;
    // Drop the admission socket before exec; never fork, replace stdio, or alter process groups.
    drop(connection);
    Err(Command::new(path).arg0(executable).args(args).exec())
}

fn run() -> io::Result<()> {
    let mut args = env::args_os().skip(1);
    match args.next() {
        Some(first) if first == "--identity" => {
            if args.next().is_some() {
                return Err(invalid("usage: --identity"));
            }
            writeln!(io::stdout().lock(), "omp-browser-helper chromium-v1")
        }
        Some(first) if first == "--register" => register(args),
        first => browser(first.into_iter().chain(args)),
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("omp-browser-helper: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNIT: &str = "omp-engineer-0123456789abcdef01234567.scope";

    #[test]
    fn response_rejects_ambiguous_framing_and_unbounded_caps() {
        for suffix in ["", "\r\n", "\nEXEC ignored\n", " \n", " extra\n"] {
            let reply = format!("EXEC {UNIT} 4294967296{suffix}");
            assert!(parse_reply(reply.as_bytes()).is_err(), "accepted {reply:?}");
        }
        for cap in ["0", "max", "+4294967296", "-1", "18446744073709551615", "18446744073709551616", "4\t294967296"] {
            let reply = format!("EXEC {UNIT} {cap}\n");
            assert!(parse_reply(reply.as_bytes()).is_err(), "accepted cap {cap:?}");
        }
        assert!(parse_reply(b"EXEC \xff 4294967296\n").is_err());
        assert!(parse_reply(&[b'x'; REPLY_LIMIT + 1]).is_err());
    }

    #[test]
    fn response_rejects_foreign_or_pathlike_scope_names() {
        for unit in ["../omp-engineer-0123456789abcdef01234567.scope",
            "omp-engineer-0123456789ABCDEF01234567.scope", "omp-engineer-0123456789abcdef0123456.scope",
            "omp-engineer-0123456789abcdef012345678.scope", "omp-engineer-0123456789abcdef01234567.scope/child",
            "other-0123456789abcdef01234567.scope", "omp-engineer-0123456789abcdef01234567.service"] {
            let reply = format!("EXEC {unit} 4294967296\n");
            assert!(parse_reply(reply.as_bytes()).is_err(), "accepted {unit:?}");
        }
        let reply = format!("EXEC {UNIT} 4294967296\n");
        let admission = parse_reply(reply.as_bytes()).expect("valid controller reply");
        assert_eq!(admission.unit, UNIT);
        assert_eq!(admission.bytes, 4_294_967_296);
    }

    #[test]
    fn memory_readback_rejects_each_weakened_or_malformed_control() {
        let good = ["4294967296\n", "0\n", "max\n", "1\n"];
        validate_controls(4_294_967_296, good[0], good[1], good[2], good[3]).expect("bounded group-OOM leaf");
        for (index, bad) in [(0, "max\n"), (0, "8589934592\n"), (0, "4294967296\n\n"),
            (1, "max\n"), (1, "1\n"), (2, "4294967296\n"), (3, "0\n"), (3, "1 0\n")] {
            let mut controls = good;
            controls[index] = bad;
            assert!(validate_controls(4_294_967_296, controls[0], controls[1], controls[2], controls[3]).is_err(),
                "accepted altered control {index}: {bad:?}");
        }
    }

    #[test]
    fn membership_rejects_nonleaf_and_duplicate_unified_paths() {
        let fleet = "/user.slice/user-1000.slice/user@1000.service/omp.slice/";
        let raw = format!("0::{fleet}{UNIT}\n");
        assert_eq!(owner_unit(&raw, fleet).expect("owner leaf"), UNIT);
        for raw in [format!("0::{fleet}{UNIT}/child\n"), format!("0::{fleet}../{UNIT}\n"),
            format!("0::{fleet}{UNIT}\n0::{fleet}{UNIT}\n"), format!("0::{fleet}{UNIT}\r\n"),
            format!("0::/user.slice/user-1001.slice/user@1001.service/omp.slice/{UNIT}\n"),
            "1:memory:/legacy\n".to_owned()] {
            assert!(owner_unit(&raw, fleet).is_err(), "accepted {raw:?}");
        }
    }

    #[test]
    fn unchanged_owner_is_not_browser_isolation() {
        let admission = Admission { unit: UNIT, bytes: 4_294_967_296 };
        // The real admission guard must reject before consulting any host cgroup state.
        assert!(verify_actual(&admission, UNIT, "/unused/").is_err());
    }
}
