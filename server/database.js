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
  
  // Create core tables
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
      duration_days INTEGER,
      cover_url TEXT,
      display_order INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER,
      title TEXT,
      video_id TEXT,
      document_url TEXT,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY(course_id) REFERENCES courses(id)
    );
    
    CREATE TABLE IF NOT EXISTS simulations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER,
      title TEXT,
      file_url TEXT,
      teacher_tag TEXT,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS simulation_courses (
      simulation_id INTEGER,
      course_id INTEGER,
      PRIMARY KEY(simulation_id, course_id),
      FOREIGN KEY(simulation_id) REFERENCES simulations(id),
      FOREIGN KEY(course_id) REFERENCES courses(id)
    );

    CREATE TABLE IF NOT EXISTS simulation_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS simulation_tag_map (
      simulation_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY(simulation_id, tag_id),
      FOREIGN KEY(simulation_id) REFERENCES simulations(id),
      FOREIGN KEY(tag_id) REFERENCES simulation_tags(id)
    );

    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      price REAL DEFAULT 0,
      original_price REAL DEFAULT 0,
      cover_url TEXT,
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS package_courses (
      package_id INTEGER,
      course_id INTEGER,
      PRIMARY KEY(package_id, course_id),
      FOREIGN KEY(package_id) REFERENCES packages(id),
      FOREIGN KEY(course_id) REFERENCES courses(id)
    );

    CREATE TABLE IF NOT EXISTS package_simulations (
      package_id INTEGER,
      simulation_id INTEGER,
      PRIMARY KEY(package_id, simulation_id),
      FOREIGN KEY(package_id) REFERENCES packages(id),
      FOREIGN KEY(simulation_id) REFERENCES simulations(id)
    );

    CREATE TABLE IF NOT EXISTS teacher_sim_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER,
      simulation_id INTEGER,
      enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(teacher_id, simulation_id),
      FOREIGN KEY(teacher_id) REFERENCES users(id),
      FOREIGN KEY(simulation_id) REFERENCES simulations(id)
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

  // === Migrations ===

  // enrollments: status
  const tableInfo = await db.all("PRAGMA table_info(enrollments)");
  if (tableInfo.length > 0 && !tableInfo.some(col => col.name === 'status')) {
      await db.run("ALTER TABLE enrollments ADD COLUMN status TEXT DEFAULT 'pending'");
      await db.run("UPDATE enrollments SET status = 'approved'");
  }

  // lessons: document_url
  const lessonInfo = await db.all("PRAGMA table_info(lessons)");
  if (lessonInfo.length > 0 && !lessonInfo.some(col => col.name === 'document_url')) {
      await db.run("ALTER TABLE lessons ADD COLUMN document_url TEXT");
  }
  // lessons: sort_order
  if (lessonInfo.length > 0 && !lessonInfo.some(col => col.name === 'sort_order')) {
      await db.run("ALTER TABLE lessons ADD COLUMN sort_order INTEGER DEFAULT 0");
      // Set existing lessons' sort_order based on rowid
      await db.run("UPDATE lessons SET sort_order = id WHERE sort_order = 0");
  }

  // courses: duration_days
  const courseInfo = await db.all("PRAGMA table_info(courses)");
  if (courseInfo.length > 0 && !courseInfo.some(col => col.name === 'duration_days')) {
      await db.run("ALTER TABLE courses ADD COLUMN duration_days INTEGER");
  }
  // courses: cover_url
  if (courseInfo.length > 0 && !courseInfo.some(col => col.name === 'cover_url')) {
      await db.run("ALTER TABLE courses ADD COLUMN cover_url TEXT");
  }
  // courses: display_order
  if (courseInfo.length > 0 && !courseInfo.some(col => col.name === 'display_order')) {
      await db.run("ALTER TABLE courses ADD COLUMN display_order INTEGER DEFAULT 0");
      await db.run("UPDATE courses SET display_order = id WHERE display_order = 0");
  }

  // enrollments: expires_at
  const enrollInfo = await db.all("PRAGMA table_info(enrollments)");
  if (enrollInfo.length > 0 && !enrollInfo.some(col => col.name === 'expires_at')) {
      await db.run("ALTER TABLE enrollments ADD COLUMN expires_at DATETIME");
  }

  // simulations: teacher_tag
  const simInfo = await db.all("PRAGMA table_info(simulations)");
  if (simInfo.length > 0 && !simInfo.some(col => col.name === 'teacher_tag')) {
      await db.run("ALTER TABLE simulations ADD COLUMN teacher_tag TEXT");
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
      const c1 = await db.run('INSERT INTO courses (title, description, display_order) VALUES (?, ?, ?)', ['ฟิสิกส์ ม.4 เทอม 1', 'การเคลื่อนที่แนวตรง, แรงและกฎการเคลื่อนที่', 1]);
      await db.run('INSERT INTO lessons (course_id, title, video_id, sort_order) VALUES (?, ?, ?, ?)', [c1.lastID, 'Ep.1 - ปริมาณทางฟิสิกส์เบื้องต้น', 'dQw4w9WgXcQ', 1]);
      await db.run('INSERT INTO lessons (course_id, title, video_id, sort_order) VALUES (?, ?, ?, ?)', [c1.lastID, 'Ep.2 - การเคลื่อนที่แนวตรง', 'dQw4w9WgXcQ', 2]);
      await db.run('INSERT INTO simulations (course_id, title, file_url, teacher_tag) VALUES (?, ?, ?, ?)', [c1.lastID, 'โปรแกรมจำลอง: การเคลื่อนที่ 1 มิติ', 'simulations/sim-motion.html', 'ครูฟิสิกส์']);
      await db.run('INSERT INTO simulations (course_id, title, file_url, teacher_tag) VALUES (?, ?, ?, ?)', [c1.lastID, 'โปรแกรมจำลอง: การตกอย่างอิสระ', 'simulations/sim-freefall.html', 'ครูฟิสิกส์']);
      
      const c2 = await db.run('INSERT INTO courses (title, description, display_order) VALUES (?, ?, ?)', ['ฟิสิกส์ ม.4 เทอม 2', 'งานและพลังงาน, โมเมนตัมและการชน', 2]);
      await db.run('INSERT INTO lessons (course_id, title, video_id, sort_order) VALUES (?, ?, ?, ?)', [c2.lastID, 'Ep.1 - งานและกำลัง', 'dQw4w9WgXcQ', 1]);
  }
}

export { getDb, initDb };
