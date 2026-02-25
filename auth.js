require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
const port = 3000;

// 1. Initialize the OAuth2 Client using our secrets from the .env file
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// 2. Define the exact permission we need (Sending emails only)
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

// 3. The route the Advisor will send to the Client
app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    // CRITICAL: 'offline' tells Google we need a Refresh Token to act in the background
    access_type: 'offline', 
    // CRITICAL: 'consent' forces Google to show the permission screen so we definitely get the token
    prompt: 'consent',      
    scope: SCOPES,
  });
  
  console.log('Redirecting user to Google for authorization...');
  res.redirect(authUrl);
});

// 4. The route Google redirects the user back to after they click "Allow"
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code; // Google gives us this temporary code
  
  if (!code) {
    return res.status(400).send('Authorization failed. No code provided.');
  }

  try {
    console.log('Authorization code received. Exchanging for tokens...');
    // Exchange the temporary code for our permanent tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    // In production, you would save this to a database securely (AES encrypted). 
    // For our Spike, we are just writing it to a local JSON file.
    fs.writeFileSync('tokens.json', JSON.stringify(tokens, null, 2));
    
    console.log('SUCCESS! Tokens saved to tokens.json.');
    res.send('<h1>Authentication successful!</h1><p>Tokens saved. You can close this window and check your code editor.</p>');
    
    // Shut down this temporary server, we don't need it anymore
    setTimeout(() => {
        console.log('Shutting down local auth server...');
        process.exit(0);
    }, 2000);

  } catch (error) {
    console.error('Error retrieving tokens:', error);
    res.status(500).send('Failed to get tokens. Check your terminal.');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`\n--- Authentication Server Running ---`);
  console.log(`Please open this URL in your browser: http://localhost:${port}/auth\n`);
});