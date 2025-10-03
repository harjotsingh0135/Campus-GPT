const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('db.sqlite', (err) => {
    if (err) {
        console.error("Error opening database " + err.message);
    } else {
        console.log("Database connected successfully.");
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            program TEXT,
            section TEXT
        )`, (err) => {
            if (err) {
                console.error("Error creating users table", err.message);
                return;
            }
            // Add a default admin if one doesn't exist
            const adminEmail = "admin@campus.com";
            db.get("SELECT * FROM users WHERE email = ?", [adminEmail], (err, row) => {
                if (!row) {
                    db.run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
                        ['Admin User', adminEmail, 'admin123', 'admin']);
                }
            });
        });

        db.run(`CREATE TABLE IF NOT EXISTS timetables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            program TEXT NOT NULL,
            section TEXT NOT NULL,
            course TEXT NOT NULL,
            day TEXT NOT NULL,
            time TEXT NOT NULL,
            room TEXT NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL,
            date TEXT NOT NULL,
            details TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            description TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            department TEXT NOT NULL,
            email TEXT NOT NULL
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_name TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            stored_filename TEXT NOT NULL,
            teacher_id INTEGER NOT NULL,
            FOREIGN KEY (teacher_id) REFERENCES users(id)
        )`);
    }
});

module.exports = db;

