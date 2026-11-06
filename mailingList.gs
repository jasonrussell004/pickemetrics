// ----------------------------------------------------------------------
// Returns a direct link to the 2nd rightmost tab of a given spreadsheet.
// ----------------------------------------------------------------------
function getLastWeeksStandingsURL() {
  const ss = SpreadsheetApp.openById(STANDINGS_SHEET_ID);
  const sheets = ss.getSheets();

  // Ensure there are at least 2 sheets
  if (sheets.length < 2) {
    return ss.getUrl(); // Fallback to base spreadsheet URL
  }

  // sheets[sheets.length - 1] is the rightmost tab
  // sheets[sheets.length - 2] is the 2nd rightmost tab
  const targetSheet = sheets[sheets.length - 2];
  const gid = targetSheet.getSheetId();

  return `https://docs.google.com/spreadsheets/d/${STANDINGS_SHEET_ID}/edit#gid=${gid}`;
}

// -------------------------------------------------------------
// Weekly Dispatcher: Sends Reminders to Verified Subscribers
// -------------------------------------------------------------
function sendWeeklyPickReminder() {
  const ss = SpreadsheetApp.openById(MAILING_SHEET_ID);
  const subSheet = ss.getSheetByName("Subscribers");
  if (!subSheet) return;

  const data = subSheet.getDataRange().getValues();

  const subscribers = new Set();
  for (let i = 0; i < data.length; i++) {
    const email = data[i][1] ? data[i][1].toString().trim() : "";
    if (email && email.includes("@")) {
      subscribers.add(email);
    }
  }

  const masterForm = FormApp.openById(MASTER_FORM_ID);
  const descMatch = masterForm.getDescription().match(/\(([^)]+)\)/);
  const firstGameTime = descMatch ? descMatch[0] : "";

  // Get the direct link to the 2nd rightmost tab
  // (Pass your picks/results sheet ID here)
  const sheetTabUrl = getLastWeeksStandingsURL();

  subscribers.forEach(email => {
    const unsubUrl = `${MAILING_WEB_APP_URL}?action=unsub&email=${encodeURIComponent(email)}`;
    const subject = "Mathlete's NFL Pickemetrics: Weekly Reminder";

    const htmlBody = `
      <p>Don't forget to submit your weekly picks before kickoff ${firstGameTime}!</p>
      <p style="margin: 18px 0;">
        <a href="${SITE_URL}" style="background-color: #007bff; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-right: 10px;">
          Submit Your Picks
        </a>
        <a href="${sheetTabUrl}" style="background-color: #6c757d; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px; font-weight: bold;">
          View Last Week's Standings
        </a>
      </p>
      <br><hr style="border: 0; border-top: 1px solid #eee;">
      <p style="font-size: 11px; color: #777;">
        You are receiving this because you opted in to pick 'em reminders. 
        <a href="${unsubUrl}">Unsubscribe from these reminders</a>
      </p>
    `;

    GmailApp.sendEmail(email, subject, "", { htmlBody: htmlBody });
  });
}
