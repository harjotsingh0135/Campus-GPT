const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const db = require('./database.js');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Multer Setup ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage });

// --- Promise-based DB Helpers ---
const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); }));
const dbGet = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); }));
const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); }));

// --- Authentication Routes ---
app.post('/signup', async (req, res) => {
    const { name, email, password, program, section } = req.body;
    if (!name || !email || !password || !program || !section) {
        return res.status(400).json({ message: "All fields are required for signup." });
    }
    try {
        const sql = 'INSERT INTO users (name, email, password, role, program, section) VALUES (?,?,?,?,?,?)';
        await dbRun(sql, [name, email, password, 'student', program, section]);
        res.status(201).json({ message: "Student account created successfully." });
    } catch (err) {
        res.status(400).json({ message: "Email already exists." });
    }
});

app.post('/login', async (req, res) => {
    const { email, password, role } = req.body;
    try {
        const row = await dbGet('SELECT * FROM users WHERE email = ? AND password = ? AND role = ?', [email, password, role]);
        if (!row) {
            return res.status(401).json({ message: "Invalid credentials or role." });
        }
        const { password: _, ...user } = row; // Omit password from response
        res.status(200).json({ message: "Login successful", user });
    } catch (err) {
        res.status(500).json({ message: "Server error during login." });
    }
});


// --- Chatbot Route ---
app.post('/ask', async (req, res) => {
    const { query, program, section } = req.body;
    const lowerQuery = query.toLowerCase();
    
    try {
        if (lowerQuery.includes('timetable') || lowerQuery.includes('class schedule')) {
            const rows = await dbAll('SELECT * FROM timetables WHERE program = ? AND section = ?', [program, section]);
            if (!rows.length) {
                return res.json({ reply: `I couldn't find a timetable for ${program}, Section ${section}. Please check with the admin.` });
            }
            const reply = `Here is the timetable for ${program} - ${section}:\n` + rows.map(r => `• ${r.course} on ${r.day} at ${r.time} in ${r.room}`).join('\n');
            return res.json({ reply });
        }
        
        if (lowerQuery.includes('exam')) {
             const rows = await dbAll('SELECT * FROM schedules');
             const reply = 'Upcoming exams:\n' + rows.map(r => `• ${r.subject} on ${r.date}: ${r.details}`).join('\n');
             return res.json({ reply });
        }
        
        if (lowerQuery.includes('faculty') || lowerQuery.includes('contact')) {
             const rows = await dbAll('SELECT * FROM contacts');
             const reply = 'Faculty Contacts:\n' + rows.map(r => `• ${r.name} (${r.department}): ${r.email}`).join('\n');
             return res.json({ reply });
        }

        if (lowerQuery.includes('event')) {
            const rows = await dbAll('SELECT * FROM events');
            const reply = 'Upcoming events:\n' + rows.map(r => `• ${r.title} on ${r.date}: ${r.description}`).join('\n');
            return res.json({ reply });
        }

        if (lowerQuery.includes('note')) {
            const fillerWords = ['notes for', 'notes on', 'note for', 'note on', 'notes', 'note', 'provide', 'me', 'with', 'give', 'get'];
            const course = fillerWords.reduce((q, word) => q.replace(new RegExp(`\\b${word}\\b`, 'gi'), ''), lowerQuery).trim();
            
            if (course) {
                const rows = await dbAll('SELECT * FROM notes WHERE lower(course_name) LIKE ?', [`%${course}%`]);
                if (rows.length > 0) {
                     const reply = `Found notes for ${course}:\n` + rows.map(r => `• ${r.original_filename} (link: /uploads/${r.stored_filename})`).join('\n');
                     return res.json({ reply });
                } else {
                     return res.json({ reply: `Sorry, I couldn't find any notes for '${course}'.` });
                }
            } else {
                 return res.json({ reply: "Which course notes are you looking for? e.g., 'DBMS notes'" });
            }
        }

        return res.json({ reply: "I can help with timetables, exams, faculty contacts, notes, and campus events. How can I assist?" });

    } catch (err) {
        res.status(500).json({ message: "Error processing chatbot query." });
    }
});


// --- Admin API Routes ---
const adminTables = ['timetables', 'schedules', 'events', 'contacts'];
adminTables.forEach(table => {
    app.get(`/api/${table}`, async (req, res) => res.json(await dbAll(`SELECT * FROM ${table}`)));
    
    app.post(`/api/${table}`, async (req, res) => {
        try {
            const columns = Object.keys(req.body);
            const placeholders = columns.map(() => '?').join(',');
            await dbRun(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`, Object.values(req.body));
            res.status(201).json({ message: "Item added successfully." });
        } catch (err) {
            res.status(400).json({ message: `Failed to add item. ${err.message}` });
        }
    });

    app.delete(`/api/${table}/:id`, async (req, res) => {
        await dbRun(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
        res.status(200).json({ message: "Deleted successfully." });
    });
});

// Admin: Manage Teachers
app.get('/api/teachers', async (req, res) => res.json(await dbAll("SELECT id, name, email FROM users WHERE role = 'teacher'")));

app.post('/api/teachers', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        await dbRun("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'teacher')", [name, email, password]);
        res.status(201).json({ message: "Teacher added successfully." });
    } catch (err) {
        res.status(400).json({ message: "Failed to add teacher. Email might already exist." });
    }
});

app.delete('/api/teachers/:id', async (req, res) => {
    await dbRun("DELETE FROM users WHERE id = ? AND role = 'teacher'", [req.params.id]);
    res.status(200).json({ message: "Teacher deleted." });
});


// --- Teacher API Routes ---
app.get('/api/notes', async (req, res) => res.json(await dbAll('SELECT * FROM notes')));

app.post('/api/notes', upload.single('note-pdf'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No PDF file was uploaded." });

    const { course_name, teacher_id } = req.body;
    if (!course_name || !teacher_id) return res.status(400).json({ message: "Course name and teacher ID are required." });

    try {
        const { originalname, filename } = req.file;
        const sql = 'INSERT INTO notes (course_name, original_filename, stored_filename, teacher_id) VALUES (?,?,?,?)';
        await dbRun(sql, [course_name, originalname, filename, teacher_id]);
        res.status(201).json({ message: "PDF uploaded successfully." });
    } catch (err) {
        res.status(500).json({ message: "Database error during file upload." });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    // Note: This doesn't delete the file from the filesystem, only the DB record.
    await dbRun('DELETE FROM notes WHERE id = ?', [req.params.id]);
    res.status(200).json({ message: "Note deleted successfully." });
});


// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

