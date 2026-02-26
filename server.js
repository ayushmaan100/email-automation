require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const db = require('./db/database');
const { encryptToken, decryptToken } = require('./utils/encryption');

const app = express();
app.use(express.json()); // Allows us to receive JSON payloads

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// ============================================================================
// 1. ADVISOR ACTION: Generate a unique authorization link for a new Client
// ============================================================================
app.post('/api/generate-auth-link', async (req, res) => {
    const { clientName, clientEmail, brokerEmail } = req.body;

    // Save the client to the DB initially without a token
    try {
        await db.query(
            `INSERT INTO clients (client_name, client_email, broker_email) 
             VALUES ($1, $2, $3) ON CONFLICT (client_email) DO NOTHING`,
            [clientName, clientEmail, brokerEmail]
        );

        // Generate the URL. We pass the clientEmail in the 'state' parameter 
        // so we know WHO just logged in when Google redirects them back.
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: ['https://www.googleapis.com/auth/gmail.send'],
            state: clientEmail 
        });

        res.json({ authUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 2. CLIENT ACTION: Google redirects here. We grab the token and encrypt it.
// ============================================================================
app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    const clientEmail = req.query.state; // We get the email back from the state param

    try {
        const { tokens } = await oauth2Client.getToken(code);
        
        if (tokens.refresh_token) {
            const encryptedToken = encryptToken(tokens.refresh_token);
            
            // Save encrypted token to the database
            await db.query(
                `UPDATE clients SET encrypted_refresh_token = $1, is_active = true 
                 WHERE client_email = $2`,
                [encryptedToken, clientEmail]
            );
            res.send('<h1>Success!</h1><p>Authorization complete. Your advisor can now send trades on your behalf.</p>');
        } else {
            res.send('No refresh token received. You may need to revoke access in your Google Account and try again.');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Authentication failed.');
    }
});

// ============================================================================
// 3. ADVISOR ACTION: Send the actual trade
// ============================================================================
app.post('/api/send-trade', async (req, res) => {
    // We added advisorIdentifier to track WHO sent it.
    const { clientEmail, tradeDetails, advisorIdentifier = "System_Test_Advisor" } = req.body;

    try {
        // 1. Fetch Client from DB
        const result = await db.query(
            `SELECT broker_email, encrypted_refresh_token FROM clients WHERE client_email = $1 AND is_active = true`,
            [clientEmail]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found or inactive.' });

        const client = result.rows[0];
        const brokerEmail = client.broker_email;
        const decryptedToken = decryptToken(client.encrypted_refresh_token);

        // 2. Load the token into Google OAuth
        oauth2Client.setCredentials({ refresh_token: decryptedToken });
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // 3. Construct Email
        const messageParts = [
            `To: ${brokerEmail}`,
            `Subject: Trade Instruction`,
            'Content-Type: text/plain; charset="UTF-8"',
            'MIME-Version: 1.0',
            '',
            `Please execute the following trade immediately:\n\n${tradeDetails}\n\nRegards,\nClient`
        ];
        
        const encodedMessage = Buffer.from(messageParts.join('\n'))
            .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        // 4. Send Email via Google API
        const sentMsg = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encodedMessage },
        });

        const googleMessageId = sentMsg.data.id;

        // 5. 🛡️ CRITICAL SEBI COMPLIANCE: Write to the Audit Log
        await db.query(
            `INSERT INTO audit_logs (advisor_identifier, client_email, broker_email, gmail_message_id, trade_details) 
             VALUES ($1, $2, $3, $4, $5)`,
            [advisorIdentifier, clientEmail, brokerEmail, googleMessageId, tradeDetails]
        );

        // 6. Return Success
        res.json({ 
            success: true, 
            messageId: googleMessageId, 
            broker: brokerEmail,
            auditStatus: "Logged Successfully"
        });

    } catch (err) {
        console.error("Trade Send Error:", err);
        // Important: If the email fails, we don't log it to the success table.
        // In a strictly compliant system, you would have a separate 'failed_trades' log here.
        res.status(500).json({ error: 'Failed to send trade.' });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Production API running on port ${PORT}`));