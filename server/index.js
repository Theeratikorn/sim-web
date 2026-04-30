import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { randomUUID } from 'crypto';
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

// Setup upload directory (supports Railway Volume via UPLOADS_DIR env var)
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer config — store temporarily then process
const multerStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const tmp = path.join(UPLOADS_DIR, '_tmp');
        if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
        cb(null, tmp);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({
    storage: multerStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['.html', '.zip', '.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('File type not allowed'));
    }
});
const uploadImage = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const d = path.join(UPLOADS_DIR, 'covers');
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
            cb(null, d);
        },
        filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: 10 * 1024 * 1024 }
});

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
const isTeacher = (req, res, next) => {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Teacher access required' });
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
        const courses = await db.all('SELECT * FROM courses ORDER BY display_order ASC');
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
            if (!req.user) { course.enrollmentStatus = 'none'; course.isExpired = false; }
            else if (req.user.role !== 'student') { course.enrollmentStatus = 'approved'; course.isExpired = false; }
            else {
                const enr = enrollmentMap[course.id];
                if (enr) {
                    course.enrollmentStatus = enr.status;
                    course.expiresAt = enr.expires_at;
                    course.isExpired = enr.expires_at && new Date(enr.expires_at) < new Date();
                } else { course.enrollmentStatus = 'none'; course.isExpired = false; }
            }
            const lessons = await db.all('SELECT * FROM lessons WHERE course_id = ? ORDER BY sort_order ASC', [course.id]);
            let completedCount = 0;
            course.lessons = lessons.map(l => {
                const isCompleted = completedLessons.has(l.id);
                if (isCompleted) completedCount++;
                return { ...l, isCompleted };
            });
            course.progressPercentage = course.lessons.length > 0 ? Math.round((completedCount / course.lessons.length) * 100) : 0;
            const sims = await db.all('SELECT * FROM simulations WHERE course_id = ?', [course.id]);
            const extraSims = await db.all(`SELECT s.* FROM simulations s JOIN simulation_courses sc ON s.id = sc.simulation_id WHERE sc.course_id = ?`, [course.id]);
            const allSimIds = new Set(sims.map(s => s.id));
            extraSims.forEach(s => { if (!allSimIds.has(s.id)) sims.push(s); });
            course.simulations = sims;
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
        const maxOrder = await db.get('SELECT MAX(display_order) as mo FROM courses');
        const order = (maxOrder.mo || 0) + 1;
        await db.run('INSERT INTO courses (title, description, duration_days, display_order) VALUES (?, ?, ?, ?)', [title, description, duration, order]);
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
        const maxOrder = await db.get('SELECT MAX(sort_order) as mo FROM lessons WHERE course_id = ?', [courseId]);
        const order = (maxOrder.mo || 0) + 1;
        await db.run('INSERT INTO lessons (course_id, title, video_id, document_url, sort_order) VALUES (?, ?, ?, ?, ?)', [courseId, title, videoId, documentUrl || null, order]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add lesson' });
    }
});

app.put('/api/lessons/:id/order', authenticateToken, isAdmin, async (req, res) => {
    const { direction } = req.body; // 'up' or 'down'
    try {
        const db = await getDb();
        const lesson = await db.get('SELECT * FROM lessons WHERE id = ?', [req.params.id]);
        if (!lesson) return res.status(404).json({ error: 'Not found' });
        const siblings = await db.all('SELECT * FROM lessons WHERE course_id = ? ORDER BY sort_order ASC', [lesson.course_id]);
        const idx = siblings.findIndex(l => l.id === lesson.id);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= siblings.length) return res.json({ success: true });
        const swap = siblings[swapIdx];
        await db.run('UPDATE lessons SET sort_order = ? WHERE id = ?', [swap.sort_order, lesson.id]);
        await db.run('UPDATE lessons SET sort_order = ? WHERE id = ?', [lesson.sort_order, swap.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reorder' });
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

// Create simulation linked to a course
app.post('/api/courses/:id/simulations', authenticateToken, isAdmin, async (req, res) => {
    const courseId = req.params.id;
    const { title, fileUrl, teacherTag, extraCourseIds } = req.body;
    try {
        const db = await getDb();
        const result = await db.run('INSERT INTO simulations (course_id, title, file_url, teacher_tag) VALUES (?, ?, ?, ?)', [courseId, title, fileUrl, teacherTag || null]);
        const simId = result.lastID;
        if (Array.isArray(extraCourseIds)) {
            for (const cid of extraCourseIds) {
                if (parseInt(cid) !== parseInt(courseId)) {
                    await db.run('INSERT OR IGNORE INTO simulation_courses (simulation_id, course_id) VALUES (?, ?)', [simId, cid]);
                }
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add simulation' });
    }
});

// Create standalone simulation (no course required)
app.post('/api/simulations', authenticateToken, isAdmin, async (req, res) => {
    const { title, fileUrl, teacherTag, courseIds } = req.body;
    try {
        const db = await getDb();
        const result = await db.run('INSERT INTO simulations (course_id, title, file_url, teacher_tag) VALUES (?, ?, ?, ?)', [null, title, fileUrl, teacherTag || null]);
        const simId = result.lastID;
        if (Array.isArray(courseIds)) {
            for (const cid of courseIds) {
                await db.run('INSERT OR IGNORE INTO simulation_courses (simulation_id, course_id) VALUES (?, ?)', [simId, cid]);
            }
        }
        res.json({ success: true, id: simId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create simulation' });
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
    const { title, description, durationDays, coverUrl } = req.body;
    try {
        const db = await getDb();
        const duration = durationDays ? parseInt(durationDays) : null;
        await db.run('UPDATE courses SET title = ?, description = ?, duration_days = ?, cover_url = COALESCE(?, cover_url) WHERE id = ?', [title, description, duration, coverUrl || null, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update course' });
    }
});

app.post('/api/courses/:id/cover', authenticateToken, isAdmin, uploadImage.single('cover'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const url = `/uploads/covers/${req.file.filename}`;
    try {
        const db = await getDb();
        await db.run('UPDATE courses SET cover_url = ? WHERE id = ?', [url, req.params.id]);
        res.json({ success: true, url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update cover' });
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

app.put('/api/simulations/:id', authenticateToken, isAdmin, async (req, res) => {
    const { title, fileUrl, teacherTag, extraCourseIds } = req.body;
    try {
        const db = await getDb();
        await db.run('UPDATE simulations SET title = ?, file_url = ?, teacher_tag = ? WHERE id = ?', [title, fileUrl, teacherTag || null, req.params.id]);
        await db.run('DELETE FROM simulation_courses WHERE simulation_id = ?', [req.params.id]);
        if (Array.isArray(extraCourseIds)) {
            const sim = await db.get('SELECT course_id FROM simulations WHERE id = ?', [req.params.id]);
            for (const cid of extraCourseIds) {
                if (sim && parseInt(cid) !== parseInt(sim.course_id)) {
                    await db.run('INSERT OR IGNORE INTO simulation_courses (simulation_id, course_id) VALUES (?, ?)', [req.params.id, cid]);
                }
            }
        }
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: 'Failed to update simulation' });
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
        await db.run('DELETE FROM simulation_courses WHERE simulation_id = ?', [req.params.id]);
        await db.run('DELETE FROM simulation_tag_map WHERE simulation_id = ?', [req.params.id]);
        await db.run('DELETE FROM teacher_sim_enrollments WHERE simulation_id = ?', [req.params.id]);
        await db.run('DELETE FROM package_simulations WHERE simulation_id = ?', [req.params.id]);
        await db.run('DELETE FROM simulations WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete simulation' });
    }
});

// --- PACKAGES API ---
app.get('/api/packages', async (req, res) => {
    try {
        const db = await getDb();
        const packages = await db.all('SELECT * FROM packages WHERE is_active = 1 ORDER BY display_order ASC');
        for (const pkg of packages) {
            pkg.courses = await db.all(`SELECT c.* FROM courses c JOIN package_courses pc ON c.id = pc.course_id WHERE pc.package_id = ?`, [pkg.id]);
            pkg.simulations = await db.all(`SELECT s.* FROM simulations s JOIN package_simulations ps ON s.id = ps.simulation_id WHERE ps.package_id = ?`, [pkg.id]);
        }
        res.json(packages);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch packages' });
    }
});

app.get('/api/admin/packages', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        const packages = await db.all('SELECT * FROM packages ORDER BY display_order ASC');
        for (const pkg of packages) {
            pkg.courses = await db.all(`SELECT c.* FROM courses c JOIN package_courses pc ON c.id = pc.course_id WHERE pc.package_id = ?`, [pkg.id]);
            pkg.simulations = await db.all(`SELECT s.* FROM simulations s JOIN package_simulations ps ON s.id = ps.simulation_id WHERE ps.package_id = ?`, [pkg.id]);
        }
        res.json(packages);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch packages' });
    }
});

app.post('/api/packages', authenticateToken, isAdmin, async (req, res) => {
    const { name, description, price, originalPrice, courseIds, simulationIds } = req.body;
    try {
        const db = await getDb();
        const maxOrder = await db.get('SELECT MAX(display_order) as mo FROM packages');
        const order = (maxOrder.mo || 0) + 1;
        const r = await db.run('INSERT INTO packages (name, description, price, original_price, display_order) VALUES (?, ?, ?, ?, ?)', [name, description, price || 0, originalPrice || 0, order]);
        const pkgId = r.lastID;
        if (Array.isArray(courseIds)) for (const cid of courseIds) await db.run('INSERT OR IGNORE INTO package_courses (package_id, course_id) VALUES (?, ?)', [pkgId, cid]);
        if (Array.isArray(simulationIds)) for (const sid of simulationIds) await db.run('INSERT OR IGNORE INTO package_simulations (package_id, simulation_id) VALUES (?, ?)', [pkgId, sid]);
        res.json({ success: true, id: pkgId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create package' });
    }
});

app.put('/api/packages/:id', authenticateToken, isAdmin, async (req, res) => {
    const { name, description, price, originalPrice, isActive, courseIds, simulationIds } = req.body;
    try {
        const db = await getDb();
        await db.run('UPDATE packages SET name=?, description=?, price=?, original_price=?, is_active=? WHERE id=?', [name, description, price||0, originalPrice||0, isActive===false?0:1, req.params.id]);
        await db.run('DELETE FROM package_courses WHERE package_id = ?', [req.params.id]);
        await db.run('DELETE FROM package_simulations WHERE package_id = ?', [req.params.id]);
        if (Array.isArray(courseIds)) for (const cid of courseIds) await db.run('INSERT OR IGNORE INTO package_courses (package_id, course_id) VALUES (?, ?)', [req.params.id, cid]);
        if (Array.isArray(simulationIds)) for (const sid of simulationIds) await db.run('INSERT OR IGNORE INTO package_simulations (package_id, simulation_id) VALUES (?, ?)', [req.params.id, sid]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update package' });
    }
});

app.post('/api/packages/:id/cover', authenticateToken, isAdmin, uploadImage.single('cover'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const url = `/uploads/covers/${req.file.filename}`;
    try {
        const db = await getDb();
        await db.run('UPDATE packages SET cover_url = ? WHERE id = ?', [url, req.params.id]);
        res.json({ success: true, url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update cover' });
    }
});

app.delete('/api/packages/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        await db.run('DELETE FROM package_courses WHERE package_id = ?', [req.params.id]);
        await db.run('DELETE FROM package_simulations WHERE package_id = ?', [req.params.id]);
        await db.run('DELETE FROM packages WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete package' });
    }
});

// --- TEACHER SIM ENROLLMENTS ---
app.get('/api/teacher/simulations', authenticateToken, isTeacher, async (req, res) => {
    try {
        const db = await getDb();
        const enrolled = await db.all(`SELECT s.*, tse.enrolled_at FROM simulations s JOIN teacher_sim_enrollments tse ON s.id = tse.simulation_id WHERE tse.teacher_id = ?`, [req.user.id]);
        res.json(enrolled);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

app.post('/api/teacher/simulations/:id/enroll', authenticateToken, isTeacher, async (req, res) => {
    try {
        const db = await getDb();
        await db.run('INSERT OR IGNORE INTO teacher_sim_enrollments (teacher_id, simulation_id) VALUES (?, ?)', [req.user.id, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to enroll' });
    }
});

app.delete('/api/teacher/simulations/:id/enroll', authenticateToken, isTeacher, async (req, res) => {
    try {
        const db = await getDb();
        await db.run('DELETE FROM teacher_sim_enrollments WHERE teacher_id = ? AND simulation_id = ?', [req.user.id, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to unenroll' });
    }
});

// Get all simulations for admin (includes course info)
app.get('/api/admin/simulations', authenticateToken, isAdmin, async (req, res) => {
    try {
        const db = await getDb();
        const sims = await db.all('SELECT * FROM simulations ORDER BY title ASC');
        for (const s of sims) {
            // Get linked courses
            if (s.course_id) {
                const mainCourse = await db.get('SELECT id, title FROM courses WHERE id = ?', [s.course_id]);
                s.mainCourse = mainCourse;
            } else {
                s.mainCourse = null;
            }
            // Get extra courses
            const extra = await db.all(`
                SELECT c.id, c.title FROM courses c 
                JOIN simulation_courses sc ON c.id = sc.course_id 
                WHERE sc.simulation_id = ?`, [s.id]);
            s.extraCourses = extra;
            s.extraCourseIds = extra.map(e => e.id);
        }
        res.json(sims);
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

// Get all simulations (public, for teacher)
app.get('/api/simulations/all', async (req, res) => {
    try {
        const db = await getDb();
        const sims = await db.all('SELECT * FROM simulations ORDER BY title ASC');
        const courses = await db.all('SELECT id, title FROM courses ORDER BY display_order ASC');
        for (const s of sims) {
            const extra = await db.all('SELECT course_id FROM simulation_courses WHERE simulation_id = ?', [s.id]);
            s.extraCourseIds = extra.map(e => e.course_id);
        }
        res.json({ simulations: sims, courses });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

// --- SIMULATION FILE UPLOAD ---
app.post('/api/simulations/upload', authenticateToken, isAdmin, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const tmpPath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    try {
        if (ext === '.html') {
            // Single HTML file — move to uploads/sims/<uuid>.html
            const destDir = path.join(UPLOADS_DIR, 'sims');
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

            const filename = `${randomUUID()}.html`;
            const destPath = path.join(destDir, filename);
            fs.renameSync(tmpPath, destPath);

            return res.json({ url: `/uploads/sims/${filename}` });

        } else if (ext === '.zip') {
            // ZIP file — extract to uploads/sims/<uuid>/
            const folderName = randomUUID();
            const destDir = path.join(UPLOADS_DIR, 'sims', folderName);
            fs.mkdirSync(destDir, { recursive: true });

            const zip = new AdmZip(tmpPath);
            zip.extractAllTo(destDir, true);
            fs.unlinkSync(tmpPath); // remove tmp zip

            // Find entry point: prefer index.html at root, else first html found
            const files = fs.readdirSync(destDir);
            let entry = files.find(f => f.toLowerCase() === 'index.html');
            if (!entry) {
                entry = files.find(f => f.toLowerCase().endsWith('.html'));
            }

            if (!entry) {
                return res.status(400).json({ error: 'No HTML entry point found in ZIP. Make sure your ZIP contains an index.html file.' });
            }

            return res.json({ url: `/uploads/sims/${folderName}/${entry}` });
        }
    } catch (err) {
        // Cleanup on error
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        console.error('Upload error:', err);
        return res.status(500).json({ error: err.message || 'Upload failed' });
    }
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
