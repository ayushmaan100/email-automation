const jwt = require('jsonwebtoken');
require('dotenv').config();

function authenticateToken(req, res, next) {
    // 1. Get the token from the Header: "Authorization: Bearer <TOKEN>"
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extract just the token

    if (!token) {
        return res.status(401).json({ error: 'Access Denied: No Token Provided' });
    }

    // 2. Verify the token using our secret key
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid Token' });
        }
        // 3. If valid, attach the user info to the request object so the next function can use it
        req.user = user;
        next(); // Pass control to the next handler (the trade sender)
    });
}

module.exports = authenticateToken;