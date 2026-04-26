const API_URL = window.location.hostname === 'localhost' && window.location.port !== '3000' ? 'http://localhost:3000/api' : '/api';
let courses = [];

// Authentication State
function isLoggedIn() {
  return localStorage.getItem('jwt_token') !== null;
}

function getCurrentUser() {
  const userStr = localStorage.getItem('currentUser');
  return userStr ? JSON.parse(userStr) : null;
}

function getAuthHeaders() {
    const token = localStorage.getItem('jwt_token');
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
}

// Fetch data from API
async function fetchCourses() {
    try {
        const response = await fetch(`${API_URL}/courses`, { headers: isLoggedIn() ? getAuthHeaders() : {} });
        if (response.ok) {
            courses = await response.json();
            // แจ้งให้หน้าอื่นๆ ทราบว่าโหลดข้อมูลเสร็จแล้ว
            document.dispatchEvent(new Event('coursesLoaded'));
        } else if (response.status === 401 || response.status === 403) {
            logout();
        }
    } catch (e) {
        console.error('Failed to fetch courses', e);
        // ถ้าเซิร์ฟเวอร์ตาย อาจจะแสดง error หรือทำ mock fallback
    }
}

async function enrollCourse(courseId) {
    if (!isLoggedIn()) {
        alert('กรุณาเข้าสู่ระบบก่อนลงทะเบียนเรียนครับ');
        window.location.href = 'login.html';
        return;
    }
    try {
        const res = await fetch(`${API_URL}/courses/${courseId}/enroll`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            alert('ลงทะเบียนเรียนสำเร็จ!');
            fetchCourses(); // ดึงข้อมูลใหม่
        } else {
            alert('ไม่สามารถลงทะเบียนได้');
        }
    } catch (e) {
        alert('Server error');
    }
}

async function markLessonComplete(lessonId) {
    if (!isLoggedIn()) return;
    try {
        const res = await fetch(`${API_URL}/lessons/${lessonId}/complete`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            alert('บันทึกการเรียนจบแล้ว!');
            fetchCourses(); // ดึงข้อมูลใหม่
        } else {
            alert('ไม่สามารถบันทึกได้');
        }
    } catch (e) {
        alert('Server error');
    }
}

// API Auth Functions
async function login(username, password) {
  try {
      const res = await fetch(`${API_URL}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
          localStorage.setItem('jwt_token', data.token);
          localStorage.setItem('currentUser', JSON.stringify(data.user));
          return true;
      } else {
          alert(data.error || 'Login failed');
          return false;
      }
  } catch (e) {
      alert('เซิร์ฟเวอร์ไม่ได้เปิดทำงาน หรือมีปัญหาการเชื่อมต่อ');
      return false;
  }
}

async function register(username, password, role) {
  try {
      const res = await fetch(`${API_URL}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, role })
      });
      if (res.ok) {
          return await login(username, password);
      } else {
          const data = await res.json();
          alert(data.error || 'Registration failed');
          return false;
      }
  } catch (e) {
      alert('เซิร์ฟเวอร์ไม่ได้เปิดทำงาน หรือมีปัญหาการเชื่อมต่อ');
      return false;
  }
}

function logout() {
  localStorage.removeItem('jwt_token');
  localStorage.removeItem('currentUser');
  window.location.href = 'index.html';
}

// UI Updates based on Auth
function updateAuthUI() {
  const authNav = document.getElementById('auth-nav');
  if (!authNav) return;

  if (isLoggedIn()) {
      const user = getCurrentUser();
      let extraLinks = '';
      if (user.role === 'admin') {
          extraLinks = `<a href="admin.html" class="btn btn-outline" style="border-color: var(--color-secondary); color: var(--color-secondary);">จัดการระบบ (Admin)</a>`;
      }

      const mainLink = user.role === 'teacher' 
          ? `<a href="teacher-dashboard.html" class="btn btn-outline">คลังโปรแกรมจำลอง</a>`
          : `<a href="courses.html" class="btn btn-outline">คอร์สเรียนของฉัน</a>`;
      
      authNav.innerHTML = `
          <span style="color: var(--text-muted); margin-right: 15px;">สวัสดี, ${user.username} <small>(${user.role})</small></span>
          ${extraLinks}
          ${mainLink}
          <button onclick="logout()" class="btn btn-primary">ออกจากระบบ</button>
      `;
  } else {
      authNav.innerHTML = `
          <a href="login.html" class="btn btn-outline">เข้าสู่ระบบ</a>
          <a href="login.html" class="btn btn-primary">สมัครฟรี</a>
      `;
  }
}

// Route Protection
function checkAuth() {
  const currentPath = window.location.pathname;
  if (currentPath.includes('course-detail.html') || currentPath.includes('lesson.html') || currentPath.includes('teacher-dashboard.html')) {
      if (!isLoggedIn()) {
          window.location.href = 'login.html';
      }
  }
  
  if (currentPath.includes('admin.html')) {
      if (!isLoggedIn() || getCurrentUser().role !== 'admin') {
          window.location.href = 'courses.html';
      }
  }

  if (currentPath.includes('login.html')) {
      if (isLoggedIn()) {
          const role = getCurrentUser().role;
          window.location.href = role === 'teacher' ? 'teacher-dashboard.html' : 'courses.html';
      }
  }
}

// Initialization on DOM load
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  updateAuthUI();
  fetchCourses();
});

function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}
