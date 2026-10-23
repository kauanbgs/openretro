//! Own emulator processes for their entire lifetime, including launcher crashes.
use std::{
    io,
    ops::{Deref, DerefMut},
    process::{Child, Command},
};

pub struct ManagedChild {
    child: Child,
    #[cfg(windows)]
    _job: windows_job::Job,
}

impl ManagedChild {
    pub fn spawn(command: &mut Command) -> io::Result<Self> {
        #[cfg(windows)]
        let job = windows_job::Job::new()?;
        let mut child = command.spawn()?;
        #[cfg(windows)]
        if let Err(error) = job.assign(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok(Self {
            child,
            #[cfg(windows)]
            _job: job,
        })
    }
}
impl Deref for ManagedChild {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.child
    }
}
impl DerefMut for ManagedChild {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}
impl Drop for ManagedChild {
    fn drop(&mut self) {
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[cfg(windows)]
mod windows_job {
    use std::{ffi::c_void, io, os::windows::io::AsRawHandle, process::Child};
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working_set: usize,
        max_working_set: usize,
        active_processes: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            job: *mut c_void,
            class: i32,
            data: *const c_void,
            size: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    pub struct Job(*mut c_void);
    impl Job {
        pub fn new() -> io::Result<Self> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = Self(handle);
            let mut limits = ExtendedLimits::default();
            limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if unsafe {
                SetInformationJobObject(
                    job.0,
                    9,
                    &limits as *const _ as *const c_void,
                    std::mem::size_of::<ExtendedLimits>() as u32,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(job)
        }
        pub fn assign(&self, child: &Child) -> io::Result<()> {
            if unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle()) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
    }
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{
        ffi::c_void,
        os::windows::{io::AsRawHandle, process::CommandExt},
    };
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn WaitForSingleObject(handle: *mut c_void, millis: u32) -> u32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    #[test]
    fn dropping_an_owned_process_reaps_it_instead_of_leaving_it_running() {
        let child = ManagedChild::spawn(
            Command::new("cmd.exe")
                .args(["/d", "/c", "ping -n 60 127.0.0.1 > nul"])
                .creation_flags(0x08000000),
        )
        .unwrap(); // CREATE_NO_WINDOW
        let handle = unsafe { OpenProcess(0x00100000, 0, child.id()) };
        assert!(!handle.is_null());
        assert_eq!(unsafe { WaitForSingleObject(handle, 0) }, 258);
        drop(child);
        assert_eq!(unsafe { WaitForSingleObject(handle, 2000) }, 0);
        unsafe {
            CloseHandle(handle);
        }
    }
    #[test]
    fn closing_the_job_handle_kills_the_process_without_the_child_wrapper() {
        let job = windows_job::Job::new().unwrap();
        let mut child = Command::new("cmd.exe")
            .args(["/d", "/c", "ping -n 60 127.0.0.1 > nul"])
            .creation_flags(0x08000000)
            .spawn()
            .unwrap();
        job.assign(&child).unwrap();
        assert_eq!(
            unsafe { WaitForSingleObject(child.as_raw_handle(), 0) },
            258
        );
        drop(job);
        assert_eq!(
            unsafe { WaitForSingleObject(child.as_raw_handle(), 2000) },
            0
        );
        child.wait().unwrap();
    }
}
