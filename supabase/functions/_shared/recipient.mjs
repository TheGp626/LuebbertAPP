// Who gets a PL mail (protocol mail, day-6 reminder). Test mode sends everything to the TEST_RECIPIENT secret;
// test mode without that secret holds the mail back instead of falling through to the real PL.
export function chooseRecipient({ mailEnabled, testMode, testRecipient, plEmail, plId }) {
  if (!mailEnabled) return { to: null, reason: 'disabled', test: false };
  if (testMode) return testRecipient ? { to: testRecipient, reason: null, test: true } : { to: null, reason: 'not_configured', test: true };
  if (!plId) return { to: null, reason: 'no_pl', test: false };
  const email = (plEmail || '').trim();
  if (!email) return { to: null, reason: 'no_email', test: false };
  return { to: email, reason: null, test: false };
}
