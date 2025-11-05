const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch'); // For making API calls
const db = require('./database.js');

const app = express();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Listening on ${PORT}'));

// --- Create 'uploads' directory if it doesn't exist ---
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`Created directory: ${uploadsDir}`);
}

app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(uploadsDir));


// --- Multer setup for file uploads ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage });


// --- Database Helpers ---
const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { if (err) reject(err); else resolve({ id: this.lastID, changes: this.changes }); }));
const dbGet = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); }));
const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); }));


// --- Authentication Routes ---
app.post('/signup', async (req, res) => {
    const { name, email, password, program, section } = req.body;
    try {
        const sql = 'INSERT INTO users (name, email, password, role, program, section) VALUES (?,?,?,?,?,?)';
        await dbRun(sql, [name, email, password, 'student', program, section]);
        res.status(201).json({ "message": "Student account created successfully." });
    } catch (err) {
        res.status(400).json({ "message": "Email already exists." });
    }
});

app.post('/login', async (req, res) => {
    const { email, password, role } = req.body;
    const sql = 'SELECT * FROM users WHERE email = ? AND password = ? AND role = ?';
    try {
        const row = await dbGet(sql, [email, password, role]);
        if (!row) return res.status(401).json({ "message": "Invalid credentials or role." });
        res.status(200).json({
            message: "Login successful",
            user: { id: row.id, name: row.name, email: row.email, role: row.role, program: row.program, section: row.section }
        });
    } catch (err) {
        res.status(500).json({ "message": "Error processing request." });
    }
});


// --- Chatbot Route with Gemini Integration ---
app.post('/ask', async (req, res) => {
    const { query, program, section } = req.body;
    const lowerCaseQuery = query.toLowerCase();
    let reply = "";
    let isCampusQuery = false;

    try {
        // 1. Check for campus-specific queries first
        if (lowerCaseQuery.includes('timetable') || lowerCaseQuery.includes('schedule') || lowerCaseQuery.includes('class')) {
            isCampusQuery = true;
            const rows = await dbAll('SELECT * FROM timetables WHERE program = ? AND section = ?', [program, section]);
            reply = rows.length > 0
                ? `Here is the timetable for ${program} Section ${section}: \n` + rows.map(r => `- ${r.course} on ${r.day} at ${r.time} in ${r.room}`).join('\n')
                : `Sorry, I couldn't find a timetable for your program and section.`;
        } else if (lowerCaseQuery.includes('exam')) {
            isCampusQuery = true;
            const rows = await dbAll('SELECT * FROM schedules');
            reply = 'Upcoming exam schedules: \n' + rows.map(r => `- ${r.subject} on ${r.date}: ${r.details}`).join('\n');
        } else if (lowerCaseQuery.includes('faculty') || lowerCaseQuery.includes('professor') || lowerCaseQuery.includes('contact')) {
            isCampusQuery = true;
            const rows = await dbAll('SELECT * FROM contacts');
            reply = 'Faculty contacts: \n' + rows.map(r => `- ${r.name} (${r.department}): ${r.email}`).join('\n');
        } else if (lowerCaseQuery.includes('event')) {
            isCampusQuery = true;
            const rows = await dbAll('SELECT * FROM events');
            reply = 'Upcoming events: \n' + rows.map(r => `- ${r.title} on ${r.date}: ${r.description}`).join('\n');
        } else if (lowerCaseQuery.includes('note')) {
            isCampusQuery = true;
            const keywords = ['notes', 'note', 'provide', 'me', 'with', 'for', 'on', 'get', 'can', 'i', 'have'];
            const subject = lowerCaseQuery.split(' ').filter(word => !keywords.includes(word)).join(' ');
            if (subject) {
                const rows = await dbAll('SELECT * FROM notes WHERE lower(course_name) LIKE ?', [`%${subject}%`]);
                reply = rows.length > 0
                    ? `Here are the notes I found for ${subject}: \n` + rows.map(r => `- ${r.original_filename} (link: /uploads/${r.stored_filename})`).join('\n')
                    : `Sorry, I couldn't find any notes for '${subject}'.`;
            } else {
                reply = "Which course notes are you looking for? For example, say 'notes for physics'.";
            }
        }

        // 2. If it's not a campus query, use the Gemini API
        if (!isCampusQuery) {
            const apiKey = ""; // In a real app, use an environment variable
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
            const payload = {
                contents: [{ parts: [{ text: query }] }],
            };

            try {
                const apiResponse = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await apiResponse.json();
                
                if (result.candidates && result.candidates.length > 0 && result.candidates[0].content.parts[0].text) {
                    reply = result.candidates[0].content.parts[0].text;
                } else {
                    reply = "Sorry, I couldn't process that request at the moment.";
                }
            } catch (apiError) {
                console.error("Gemini API Error:", apiError);
                reply = "Sorry, I'm having trouble connecting to my knowledge base right now.";
            }
        }

        res.json({ reply });

    } catch (dbError) {
        console.error("Database Error:", dbError);
        res.status(500).json({ "message": "Error processing your request with the campus database." });
    }
});


// --- Generic API CRUD Endpoints ---
const tables = ['teachers', 'timetables', 'schedules', 'events', 'contacts'];
tables.forEach(table => {
    app.get(`/api/${table}`, async (req, res) => {
        const isTeachers = table === 'teachers';
        const sql = isTeachers ? `SELECT id, name, email, role FROM users WHERE role = 'teacher'` : `SELECT * FROM ${table}`;
        try { const rows = await dbAll(sql); res.json(rows); } catch (err) { res.status(500).json({ message: err.message }); }
    });
    app.get(`/api/${table}/:id`, async (req, res) => {
        const isTeachers = table === 'teachers';
        const sql = isTeachers ? `SELECT id, name, email FROM users WHERE id = ? AND role = 'teacher'` : `SELECT * FROM ${table} WHERE id = ?`;
        try { const row = await dbGet(sql, [req.params.id]); if(row) res.json(row); else res.status(404).json({ message: "Item not found" }); } catch (err) { res.status(500).json({ message: err.message }); }
    });
    app.post(`/api/${table}`, async (req, res) => {
        if (table === 'teachers') {
             const { name, email, password } = req.body;
             try { if (!name || !email || !password) return res.status(400).json({ "message": "Missing required fields." }); const sql = 'INSERT INTO users (name, email, password, role) VALUES (?,?,?,?)'; const result = await dbRun(sql, [name, email, password, 'teacher']); return res.status(201).json({ id: result.id }); } catch (err) { return res.status(400).json({ "message": "Email already exists or invalid data." }); }
        }
        const columns = Object.keys(req.body); const placeholders = columns.map(() => '?').join(','); const values = Object.values(req.body); const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`; try { const result = await dbRun(sql, values); res.status(201).json({ id: result.id }); } catch (err) { res.status(400).json({ message: err.message }); }
    });
    app.put(`/api/${table}/:id`, async (req, res) => {
        const { password, ...dataToUpdate } = req.body;
        if (table === 'teachers') {
            const { name, email } = dataToUpdate; let sql, params; if (password) { sql = 'UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?'; params = [name, email, password, req.params.id]; } else { sql = 'UPDATE users SET name = ?, email = ? WHERE id = ?'; params = [name, email, req.params.id]; }
             try { const result = await dbRun(sql, params); if (result.changes === 0) return res.status(404).json({ message: "Teacher not found" }); return res.status(200).json({ message: "Updated successfully" }); } catch (err) { return res.status(400).json({ message: "Email may already be in use." }); }
        }
        const columns = Object.keys(dataToUpdate); const values = Object.values(dataToUpdate); const setClauses = columns.map(col => `${col} = ?`).join(', '); if (columns.length === 0) return res.status(400).json({ message: "No data provided." });
        const sql = `UPDATE ${table} SET ${setClauses} WHERE id = ?`; try { const result = await dbRun(sql, [...values, req.params.id]); if (result.changes === 0) return res.status(404).json({ message: "Item not found" }); res.status(200).json({ message: "Updated successfully" }); } catch (err) { res.status(400).json({ message: err.message }); }
    });
    app.delete(`/api/${table}/:id`, async (req, res) => {
        const sql = table === 'teachers' ? `DELETE FROM users WHERE id = ?` : `DELETE FROM ${table} WHERE id = ?`;
        try { const result = await dbRun(sql, req.params.id); if (result.changes === 0) return res.status(404).json({message: "Not found"}); res.status(200).json({ message: "Deleted successfully" }); } catch (err) { res.status(400).json({ message: err.message }); }
    });
});
app.get('/api/notes', async (req, res) => { try { const rows = await dbAll(`SELECT * FROM notes`); res.json(rows); } catch (err) { res.status(500).json({ message: err.message }); } });
app.post('/api/notes', upload.single('note-pdf'), async (req, res) => {
    if (!req.file) { return res.status(400).json({ message: "File is missing." }); }
    const { course_name, teacher_id } = req.body; if (!course_name || !teacher_id) { return res.status(400).json({ message: "Course name or teacher ID is missing." }); }
    const { originalname, filename } = req.file; const sql = 'INSERT INTO notes (course_name, original_filename, stored_filename, teacher_id) VALUES (?,?,?,?)';
    try { const result = await dbRun(sql, [course_name, originalname, filename, teacher_id]); res.status(201).json({ message: "File uploaded successfully!", id: result.id }); } catch (err) { res.status(400).json({ message: err.message }); }
});
app.delete('/api/notes/:id', async (req, res) => { const sql = `DELETE FROM notes WHERE id = ?`; try { const result = await dbRun(sql, req.params.id); if (result.changes === 0) return res.status(404).json({message: "Not found"}); res.status(200).json({ message: "Note deleted successfully" }); } catch (err) { res.status(400).json({ message: err.message }); } });

app.listen(PORT, () => console.log(`Server is running on http://localhost:3000`));

