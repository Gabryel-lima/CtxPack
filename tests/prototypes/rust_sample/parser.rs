// Rust parser fixture focused on tokenization and command parsing.

pub struct CommandParser {
    prefix: String,
}

impl CommandParser {
    pub fn new(prefix: &str) -> Self {
        Self { prefix: prefix.to_string() }
    }

    pub fn parse(&self, input: &str) -> Vec<&str> {
        input.trim_start_matches(&self.prefix).split_whitespace().collect()
    }
}

pub fn normalize(input: &str) -> String {
    input.trim().to_lowercase()
}