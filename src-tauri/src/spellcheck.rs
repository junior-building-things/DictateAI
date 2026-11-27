//! System-dictionary gate for silent vocabulary learning. Call on the main thread.

use std::ffi::{CStr, CString};

use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl, Encode, Encoding};

#[link(name = "AppKit", kind = "framework")]
extern "C" {}

#[repr(C)]
struct NSRange {
    location: usize,
    length: usize,
}

unsafe impl Encode for NSRange {
    fn encode() -> Encoding {
        // NSUInteger is 64-bit on both supported macOS architectures.
        unsafe { Encoding::from_str("{_NSRange=QQ}") }
    }
}

/// Return only words the selected dictionary marks as misspelled. Unknown
/// languages fail closed rather than treating every word as new vocabulary.
pub fn unknown_terms(terms: Vec<String>, language: &str) -> Result<Vec<String>, String> {
    objc::rc::autoreleasepool(|| unsafe {
        let checker: *mut Object = msg_send![class!(NSSpellChecker), sharedSpellChecker];
        if checker.is_null() {
            return Err("System dictionary is unavailable".into());
        }
        let languages: *mut Object = msg_send![checker, availableLanguages];
        let count: usize = msg_send![languages, count];
        let requested = language.split(['_', '-']).next().unwrap_or(language);
        let mut selected: *mut Object = std::ptr::null_mut();
        for i in 0..count {
            let candidate: *mut Object = msg_send![languages, objectAtIndex: i];
            let utf8: *const std::os::raw::c_char = msg_send![candidate, UTF8String];
            let code = CStr::from_ptr(utf8).to_string_lossy();
            if code
                .split(['_', '-'])
                .next()
                .is_some_and(|code| code.eq_ignore_ascii_case(requested))
            {
                selected = candidate;
                break;
            }
        }
        if selected.is_null() {
            return Err(format!("No system dictionary for {language}"));
        }

        let mut unknown = Vec::new();
        for term in terms {
            let normalized = term.to_lowercase().replace('\u{2019}', "'");
            let text = CString::new(normalized).map_err(|_| "Invalid vocabulary term")?;
            let text: *mut Object =
                msg_send![class!(NSString), stringWithUTF8String: text.as_ptr()];
            let range: NSRange = msg_send![checker,
                checkSpellingOfString: text
                startingAt: 0isize
                language: selected
                wrap: false
                inSpellDocumentWithTag: 0isize
                wordCount: std::ptr::null_mut::<isize>()];
            if range.length > 0 {
                unknown.push(term);
            }
        }
        Ok(unknown)
    })
}

#[cfg(test)]
mod tests {
    use super::unknown_terms;

    #[test]
    fn filters_dictionary_words_and_preserves_unfamiliar_terms() {
        let terms = [
            "fully",
            "can't",
            "can\u{2019}t",
            "Dec",
            "implemented",
            "Implemented",
            "comment",
            "issue",
            "ByteCloud",
            "Sinead",
            "Zorbatek",
        ];
        assert_eq!(
            unknown_terms(terms.map(String::from).to_vec(), "en").unwrap(),
            ["ByteCloud", "Sinead", "Zorbatek"]
        );
        assert_eq!(
            unknown_terms(vec!["fully".into(), "Zorbatek".into()], "en-US").unwrap(),
            ["Zorbatek"]
        );
        for (language, word) in [("sv", "hej"), ("fi", "kiitos")] {
            assert_eq!(
                unknown_terms(vec![word.into(), "Zorbatek".into()], language).unwrap(),
                ["Zorbatek"]
            );
        }
        assert!(unknown_terms(vec!["Zorbatek".into()], "zz").is_err());
        assert!(unknown_terms(vec!["invalid\0term".into()], "en").is_err());
    }
}
