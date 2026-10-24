//! Only session credentials enter the OS vault; settings and JS never receive them.
use super::{AccountError, AccountResult};

pub trait Vault {
    fn read(&self) -> AccountResult<Option<String>>;
    fn write(&self, token: &str) -> AccountResult<()>;
    fn clear(&self) -> AccountResult<()>;
}

pub struct NativeVault(pub String);
impl NativeVault {
    pub fn for_origin(origin: &str) -> Self {
        Self(format!("OpenRetro/Social/v1/{origin}"))
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    struct Credential(*mut CREDENTIALW);
    impl Drop for Credential {
        fn drop(&mut self) {
            unsafe {
                CredFree(self.0.cast());
            }
        }
    }
    impl Vault for NativeVault {
        fn read(&self) -> AccountResult<Option<String>> {
            let target = wide(&self.0);
            let mut credential = std::ptr::null_mut();
            if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
                return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err(AccountError::vault())
                };
            }
            let owned = Credential(credential);
            let value = unsafe { &*owned.0 };
            if value.CredentialBlobSize != 64 || value.CredentialBlob.is_null() {
                return Err(AccountError::vault());
            }
            let bytes = unsafe {
                std::slice::from_raw_parts(value.CredentialBlob, value.CredentialBlobSize as usize)
            };
            let token = std::str::from_utf8(bytes).map_err(|_| AccountError::vault())?;
            if !super::super::valid_token(token) {
                return Err(AccountError::vault());
            }
            Ok(Some(token.to_owned()))
        }
        fn write(&self, token: &str) -> AccountResult<()> {
            if !super::super::valid_token(token) {
                return Err(AccountError::vault());
            }
            let mut target = wide(&self.0);
            let mut username = wide("OpenRetro");
            let credential = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: target.as_mut_ptr(),
                CredentialBlobSize: token.len() as u32,
                CredentialBlob: token.as_ptr() as *mut u8,
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                UserName: username.as_mut_ptr(),
                ..Default::default()
            };
            if unsafe { CredWriteW(&credential, 0) } == 0 {
                return Err(AccountError::vault());
            }
            Ok(())
        }
        fn clear(&self) -> AccountResult<()> {
            let target = wide(&self.0);
            if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
                && unsafe { GetLastError() } != ERROR_NOT_FOUND
            {
                return Err(AccountError::vault());
            }
            Ok(())
        }
    }
}
#[cfg(not(windows))]
impl Vault for NativeVault {
    fn read(&self) -> AccountResult<Option<String>> {
        Err(AccountError::unsupported())
    }
    fn write(&self, _: &str) -> AccountResult<()> {
        Err(AccountError::unsupported())
    }
    fn clear(&self) -> AccountResult<()> {
        Err(AccountError::unsupported())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    #[ignore = "manual Windows Credential Manager integration; uses and deletes only a dedicated test entry"]
    fn windows_credential_roundtrip() {
        let vault = NativeVault(format!("OpenRetro/Tests/Social/{}", uuid::Uuid::new_v4()));
        struct Cleanup<'a>(&'a NativeVault);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = self.0.clear();
            }
        }
        let _cleanup = Cleanup(&vault);
        assert!(vault.read().unwrap().is_none());
        let token = "a".repeat(64); // Deliberately invalid as a real service credential.
        vault.write(&token).unwrap();
        assert!(vault.read().unwrap().as_deref() == Some(token.as_str()));
        assert!(vault.write("malformed").is_err());
        vault.clear().unwrap();
        assert!(vault.read().unwrap().is_none());
    }
}
