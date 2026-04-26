import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';

// Open SQLite database
async function getDb() {
  const dbDir = path.resolve('server');
  if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir);
  }
  return open({
    filename: path.join(dbDir, 'database.sqlite'),
    driver: sqlite3.Database
  });
}

async function initDb() {
  const db = await getDb();
  
  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT
    );
    
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      duration_days INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER,
      title TEXT,
      video_id TEXT,
      FOREIGN KEY(course_id) REFERENCES courses(id)
    );
    
    CREATE TABLE IF NOT EXISTS simulations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER,
      title TEXT,
      file_url TEXT,
      FOREIGN KEY(course_id) REFERENCES courses(id)
    );
    
    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      course_id INTEGER,
      status TEXT DEFAULT 'pending',
      expires_at DATETIME,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(course_id) REFERENCES courses(id)
    );
    
    CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      lesson_id INTEGER,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, lesson_id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(lesson_id) REFERENCES lessons(id)
    );
  `);

  // Migrate old db if missing status
  const tableInfo = await db.all("PRAGMA table_info(enrollments)");
  if (tableInfo.length > 0 && !tableInfo.some(col => col.name === 'status')) {
      await db.run("ALTER TABLE enrollments ADD COLUMN status TEXT DEFAULT 'pending'");
      await db.run("UPDATE enrollments SET status = 'approved'"); // Give old ones approved status
  }

  // Migrate old db if missing document_url
  const lessonInfo = await db.all("PRAGMA table_info(lessons)");
  if (lessonInfo.length > 0 && !lessonInfo.some(col => col.name === 'document_url')) {
      await db.run("ALTER TABLE lessons ADD COLUMN document_url TEXT");
  }

  // Migrate old db if missing duration_days
  const courseInfo = await db.all("PRAGMA table_info(courses)");
  if (courseInfo.length > 0 && !courseInfo.some(col => col.name === 'duration_days')) {
      await db.run("ALTER TABLE courses ADD COLUMN duration_days INTEGER");
  }

  // Migrate old db if missing expires_at
  const enrollInfo = await db.all("PRAGMA table_info(enrollments)");
  if (enrollInfo.length > 0 && !enrollInfo.some(col => col.name === 'expires_at')) {
      await db.run("ALTER TABLE enrollments ADD COLUMN expires_at DATETIME");
  }

  // Insert default admin
  const adminExists = await db.get('SELECT * FROM users WHERE username = ?', ['admin']);
  if (!adminExists) {
      const hash = await bcrypt.hash('admin', 10);
      await db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', ['admin', hash, 'admin']);
  }

  // Insert default courses if empty
  const courseCount = await db.get('SELECT COUNT(*) as count FROM courses');
  if (courseCount.count === 0) {
      // Course 1
      const c1 = await db.run('INSERT INTO courses (title, description) VALUES (?, ?)', ['ฟิสิกส์ ม.4 เทอม 1', 'การเคลื่อนที่แนวตรง, แรงและกฎการเคลื่อนที่']);
      await db.run('INSERT INTO lessons (course_id, title, video_id) VALUES (?, ?, ?)', [c1.lastID, 'Ep.1 - ปริมาณทางฟิสิกส์เบื้องต้น', 'dQw4w9WgXcQ']);
      await db.run('INSERT INTO lessons (course_id, title, video_id) VALUES (?, ?, ?)', [c1.lastID, 'Ep.2 - การเคลื่อนที่แนวตรง', 'dQw4w9WgXcQ']);
      await db.run('INSERT INTO simulations (course_id, title, file_url) VALUES (?, ?, ?)', [c1.lastID, 'โปรแกรมจำลอง: การเคลื่อนที่ 1 มิติ', 'simulations/sim-motion.html']);
      await db.run('INSERT INTO simulations (course_id, title, file_url) VALUES (?, ?, ?)', [c1.lastID, 'โปรแกรมจำลอง: การตกอย่างอิสระ', 'simulations/sim-freefall.html']);
      
      // Course 2
      const c2 = await db.run('INSERT INTO courses (title, description) VALUES (?, ?)', ['ฟิสิกส์ ม.4 เทอม 2', 'งานและพลังงาน, โมเมนตัมและการชน']);
      await db.run('INSERT INTO lessons (course_id, title, video_id) VALUES (?, ?, ?)', [c2.lastID, 'Ep.1 - งานและกำลัง', 'dQw4w9WgXcQ']);
  }
}

export { getDb, initDb };
