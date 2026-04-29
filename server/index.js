import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, initDb } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'grow-up-study-secret-key';

app.use(cors());
app.use(express.json());

// Serve static assets
app.use('/css', express.static(path.join(__dirname, '../css')));
app.use('/js', express.static(path.join(__dirname, '../js')));
app.use('/simulations', express.static(path.join(__dirname, '../simulations')));

// Serve HTML files
app.get(/.*\.html$/, (req, res) => {
    res.sendFile(path.join(__dirname, '..', req.path));
});
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Init DB
initDb().then(() => console.log('Database initialized'));

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        req.user = user;
        next();
    });
};

const optionalToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) {
        req.user = null;
        return next();
    }

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            req.user = null;
            return next();
        }
        req.user = user;
        next();
    });
};

// Middleware to verify Admin role
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// --- AUTH API ---

app.post('/api/register', async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });

    try {
        const db = await getDb();
        const hash = await bcrypt.hash(password, 10);
        await db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, role]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Username may already exist' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const db = await getDb();
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ token, user: { username: user.username, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// --- CONTENT API ---

app.get('/api/courses', optionalToken, async (req, res) => {
    try {
        const db = await getDb();
        const courses = await db.all('SELECT * FROM courses');
        
        let enrollments = [];
        let completedLessons = new Set();
        if (req.user && req.user.role === 'student') {
            const progress = await db.all('SELECT lesson_id FROM progress WHERE user_id = ?', [req.user.id]);
            completedLessons = new Set(progress.map(p => p.lesson_id));
            enrollments = await db.all('SELECT course_id, status, expires_at FROM enrollments WHERE user_id = ?', [req.user.id]);
        }
        
        const enrollmentMap = {};
        enrollments.forEach(e => enrollmentMap[e.course_id] = { status: e.status, expires_at: e.expires_at });
        
        for (let course of courses) {
            if (!req.user) {
                course.enrollmentStatus = 'none';
                course.isExpired = false;
            } else if (req.user.role !== 'student') {
                course.enrollmentStatus = 'approved';
                course.isExpired = false;
            } else {
                const enr = enrollmentMap[course.id];
                if (enr) {
                    course.enrollmentStatus = enr.status;
                    course.expiresAt = enr.expires_at;
                    if (enr.expires_at && new Date(enr.expires_at) < new Date()) {
                        course.isExpired = true;
                    } else {
                        course.isExpired = false;
                    }
                } else {
                    course.enrollmentStatus = 'none';
                    course.isExpired = false;
                }
            }
            
            const lessons = await db.all('SELECT * FROM lessons WHERE course_id = ?', [course.id]);
            let completedCount = 0;
            course.lessons = lessons.map(l => {
                const isCompleted = completedLessons.has(l.id);
                if (isCompleted) completedCount++;
                return { ...l, isCompleted };
            });
            
            course.progressPercentage = course.lessons.length > 0 ? Math.round((completedCount / course.lessons.length) * 100) : 0;
            course.simulations = await db.all('SELECT * FROM simulations WHERE course_id = ?', [course.id]);
        }
        
        res.json(courses);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch courses' });
    }
});

app.post('/api/courses/:id/enroll', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') return res.status(400).json({ error: 'Only students need to enroll' });
    
    const courseId = parseInt(req.params.id);
    const userId = req.user.id;
    
    try {
        const db = await getDb();
        const existing = await db.get('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?', [userId, courseId]);
        if (!existing) {
            await db.run('INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)', [userId, courseId]);
            res.json({ success: true });
        } else {
            if (existing.expires_at && new Date(existing.expires_at) < new Date()) {
                await db.run("UPDATE enrollments SET status = 'pending', expires_at = NULL WHERE id = ?", [existing.id]);
                res.json({ success: true });
            } else if (existing.status !== 'approved' && existing.status !== 'pending') {
                await db.run("UPDATE enrollments SET status = 'pending' WHERE id = ?", [existing.id]);
                res.json({ success: true });
            } else {
                return res.status(400).json({ error: 'คุณลงทะเบียนหรือรอการอนุมัติอยู่แล้ว' });
            }
        }
    } catch (err) {
        res.status(500).json({ error: 'Enrollment failed' });
    }
});

app.get('/api/admin/enrollments', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        const pending = await db.all(`
            SELECT e.id, u.username, c.title as courseTitle 
            FROM enrollments e 
            JOIN users u ON e.user_id = u.id 
            JOIN courses c ON e.course_id = c.id 
            WHERE e.status = 'pending'
        `);
        res.json(pending);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch enrollments' });
    }
});

app.post('/api/admin/enrollments/:id/approve', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        const enrollment = await db.get('SELECT * FROM enrollments WHERE id = ?', [req.params.id]);
        if (!enrollment) return res.status(404).json({ error: 'Not found' });
        
        const course = await db.get('SELECT * FROM courses WHERE id = ?', [enrollment.course_id]);
        let expiresAt = null;
        if (course.duration_days) {
            const date = new Date();
            date.setDate(date.getDate() + course.duration_days);
            expiresAt = date.toISOString();
        }
        
        await db.run("UPDATE enrollments SET status = 'approved', expires_at = ? WHERE id = ?", [expiresAt, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to approve enrollment' });
    }
});

app.post('/api/courses', authenticateToken, isAdmin, async (req, res) => {
    const { title, description, durationDays } = req.body;
    try {
        const db = await getDb();
        const duration = durationDays ? parseInt(durationDays) : null;
        await db.run('INSERT INTO courses (title, description, duration_days) VALUES (?, ?, ?)', [title, description, duration]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create course' });
    }
});

app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        const users = await db.all('SELECT id, username, role FROM users');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.put('/api/admin/users/:id/role', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        const { role } = req.body;
        await db.run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update user role' });
    }
});

app.get('/api/admin/enrollments/active', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        const active = await db.all(`
            SELECT e.id, u.username, c.title as courseTitle, e.expires_at 
            FROM enrollments e 
            JOIN users u ON e.user_id = u.id 
            JOIN courses c ON e.course_id = c.id 
            WHERE e.status = 'approved'
        `);
        res.json(active);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch active enrollments' });
    }
});

app.delete('/api/admin/enrollments/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        await db.run('DELETE FROM enrollments WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete enrollment' });
    }
});

app.post('/api/courses/:id/lessons', authenticateToken, isAdmin, async (req, res) => {
    const courseId = req.params.id;
    const { title, videoId, documentUrl } = req.body;
    try {
        const db = await getDb();
        await db.run('INSERT INTO lessons (course_id, title, video_id, document_url) VALUES (?, ?, ?, ?)', [courseId, title, videoId, documentUrl || null]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add lesson' });
    }
});

app.post('/api/lessons/:id/complete', authenticateToken, async (req, res) => {
    const lessonId = parseInt(req.params.id);
    const userId = req.user.id;
    try {
        const db = await getDb();
        await db.run('INSERT OR IGNORE INTO progress (user_id, lesson_id) VALUES (?, ?)', [userId, lessonId]);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: 'Failed to update progress' });
    }
});

app.post('/api/courses/:id/simulations', authenticateToken, isAdmin, async (req, res) => {
    const courseId = req.params.id;
    const { title, fileUrl } = req.body;
    try {
        const db = await getDb();
        await db.run('INSERT INTO simulations (course_id, title, file_url) VALUES (?, ?, ?)', [courseId, title, fileUrl]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add simulation' });
    }
});

app.put('/api/admin/password', authenticateToken, isAdmin, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const db = await getDb();
        const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
        
        const match = await bcrypt.compare(oldPassword, user.password_hash);
        if (!match) return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
        
        const hash = await bcrypt.hash(newPassword, 10);
        await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to change password' });
    }
});

app.put('/api/courses/:id', authenticateToken, isAdmin, async (req, res) => {
    const { title, description, durationDays } = req.body;
    try {
        const db = await getDb();
        const duration = durationDays ? parseInt(durationDays) : null;
        await db.run('UPDATE courses SET title = ?, description = ?, duration_days = ? WHERE id = ?', [title, description, duration, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update course' });
    }
});

app.delete('/api/courses/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        await db.run('DELETE FROM progress WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)', [req.params.id]);
        await db.run('DELETE FROM lessons WHERE course_id = ?', [req.params.id]);
        await db.run('DELETE FROM simulations WHERE course_id = ?', [req.params.id]);
        await db.run('DELETE FROM enrollments WHERE course_id = ?', [req.params.id]);
        await db.run('DELETE FROM courses WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete course' });
    }
});

app.put('/api/lessons/:id', authenticateToken, isAdmin, async (req, res) => {
    const { title, videoId, documentUrl } = req.body;
    try {
        const db = await getDb();
        await db.run('UPDATE lessons SET title = ?, video_id = ?, document_url = ? WHERE id = ?', [title, videoId, documentUrl || null, req.params.id]);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: 'Failed to update lesson' });
    }
});

app.delete('/api/lessons/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        await db.run('DELETE FROM progress WHERE lesson_id = ?', [req.params.id]);
        await db.run('DELETE FROM lessons WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete lesson' });
    }
});

app.delete('/api/simulations/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        await db.run('DELETE FROM simulations WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete simulation' });
    }
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
