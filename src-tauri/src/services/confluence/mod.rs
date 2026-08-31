pub mod client;
mod service;
#[cfg(test)]
mod sync_mock_tests;

pub use service::ConfluenceService;
