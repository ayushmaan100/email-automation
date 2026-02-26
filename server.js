require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const db = require('./db/database');
const { encryptToken, decryptToken } = require('./utils/encryption');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authenticateToken = require('./utils/middleware'); // Import the guard


const app = express();
app.use(cors());
app.use(express.json()); // Allows us to receive JSON payloads

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// ============================================================================
// 1. ADVISOR ACTION: Generate a unique authorization link for a new Client
// ============================================================================
app.post('/api/generate-auth-link', authenticateToken, async (req, res) => {
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
// ============================================================================
// ============================================================================
// TEMPORARY ROUTE: Create a test advisor (Run this once, then you can delete it)
// ============================================================================
app.post('/api/create-advisor', async (req, res) => {
    const { email, password, fullName } = req.body;
    
    try {
        // Scramble the password so it's safe in the database
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        await db.query(
            `INSERT INTO advisors (email, password_hash, full_name) VALUES ($1, $2, $3)`,
            [email, hashedPassword, fullName]
        );
        res.json({ message: 'Advisor Created Successfully' });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// ============================================================================
// ADVISOR LOGIN: Verifies password and hands out the JWT "ID Badge"
// ============================================================================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        // 1. Find the advisor in the database
        const result = await db.query('SELECT * FROM advisors WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ error: 'Advisor not found' });
        
        const advisor = result.rows[0];

        // 2. Check if the password is correct
        const validPass = await bcrypt.compare(password, advisor.password_hash);
        if (!validPass) return res.status(400).json({ error: 'Invalid Password' });

        // 3. Create the JWT Token (The digital ID badge)
        const token = jwt.sign(
            { id: advisor.id, email: advisor.email }, // Data stored inside the badge
            process.env.JWT_SECRET,                   // Locked with your secret key
            { expiresIn: '8h' }                       // Expires in 8 hours
        );

        res.json({ message: "Login successful", token: token });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 3. ADVISOR ACTION: Send the actual trade
// ============================================================================
// ============================================================================
// PROTECTED ADVISOR ACTION: Send trade & Log it (Requires JWT Token)
// ============================================================================
// Notice 'authenticateToken' is now the middleman intercepting the request
app.post('/api/send-trade', authenticateToken, async (req, res) => {
    const { clientEmail, tradeDetails } = req.body;
    
    // We get the Advisor's identity strictly from their secure token!
    const advisorEmail = req.user.email; 

    try {
        const result = await db.query(
            `SELECT broker_email, encrypted_refresh_token FROM clients WHERE client_email = $1 AND is_active = true`,
            [clientEmail]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found or inactive.' });

        const client = result.rows[0];
        const brokerEmail = client.broker_email;
        const decryptedToken = decryptToken(client.encrypted_refresh_token);

        oauth2Client.setCredentials({ refresh_token: decryptedToken });
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

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

        const sentMsg = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encodedMessage },
        });

        const googleMessageId = sentMsg.data.id;

        // Write to the Audit Log using the verified advisorEmail
        await db.query(
            `INSERT INTO audit_logs (advisor_identifier, client_email, broker_email, gmail_message_id, trade_details) 
             VALUES ($1, $2, $3, $4, $5)`,
            [advisorEmail, clientEmail, brokerEmail, googleMessageId, tradeDetails]
        );

        res.json({ 
            success: true, 
            messageId: googleMessageId, 
            broker: brokerEmail,
            auditStatus: "Logged Successfully"
        });

    } catch (err) {
        console.error("Trade Send Error:", err);
        res.status(500).json({ error: 'Failed to send trade.' });
    }
});


const PORT = 3000;
app.listen(PORT, () => console.log(`Production API running on port ${PORT}`));