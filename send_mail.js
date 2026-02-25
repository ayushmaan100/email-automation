require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');

// 1. Load the saved tokens (In production, this comes from your database)
const tokenPath = 'tokens.json';
if (!fs.existsSync(tokenPath)) {
  console.error('Error: tokens.json not found. Did you run auth.js first?');
  process.exit(1);
}
const tokens = JSON.parse(fs.readFileSync(tokenPath));

// 2. Reconstruct the OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// 3. Set the credentials. 
// Magic feature: The Google SDK automatically uses the refresh_token 
// to get a new access_token if the current one has expired!
oauth2Client.setCredentials(tokens);

// 4. Initialize the Gmail API
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

async function sendTradeEmail(brokerEmail, tradeDetails) {
  // 5. Construct the raw email string (RFC 2822 format)
  // Notice we do NOT set a 'From' header. Google strictly enforces that the 
  // 'From' address matches the authenticated user (The Client).
  const subject = 'Trade Instruction - URGENT';
  const utf8Subject = `=?utf8?B?${Buffer.from(subject).toString('base64')}?=`;
  
  const messageParts = [
    `To: ${brokerEmail}`,
    `Subject: ${utf8Subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '', // This empty line strictly separates headers from the body
    `Please execute the following trade immediately:\n\n${tradeDetails}\n\nRegards,\nYour Client`
  ];
  
  const message = messageParts.join('\n');

  // 6. Encode the message in Base64URL format (Strict requirement by Gmail API)
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    console.log(`Sending email to ${brokerEmail}...`);
    
    // 7. Send the email! 'userId: me' tells Google to use the token's owner.
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log('\n✅ SUCCESS! Email sent.');
    console.log('Gmail Message ID:', res.data.id);
    console.log('Check the "Sent" folder of the Client account, and the Inbox of the Broker account.');
    
  } catch (error) {
    console.error('\n❌ Failed to send email:', error.message);
    if (error.response && error.response.data && error.response.data.error) {
        console.error('Detailed API Error:', error.response.data.error);
    }
  }
}

// ============================================================================
// EXECUTION
// ============================================================================
// CHANGE THIS to your secondary testing email so you can check the inbox!
const testBrokerEmail = 'ayushmaan.at2004@gmail.com'; 
const sampleTrade = 'Buy 1000 shares of Reliance Industries @ Market Price';

sendTradeEmail(testBrokerEmail, sampleTrade);
