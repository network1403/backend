
require('dotenv').config(); // تحميل متغيرات البيئة من ملف .env
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;

// إعداد الاتصال بقاعدة البيانات الأونلاين
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // ضروري جداً للاتصال بالسيرفرات السحابية مثل Render و Heroku
    }
});

app.use(cors());
app.use(express.json());
///////////////////////////////////////////////////////////////////////////////////////////////////////////////
// 1. جلب جميع الجهات
app.get('/contacts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM contacts ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب البيانات' });
    }
});

// 2. إضافة اسم جديد
app.post('/contacts', async (req, res) => {
    const { name, phone } = req.body;
    try {
        await pool.query('INSERT INTO contacts (name, phone) VALUES ($1, $2)', [name, phone]);
        res.status(201).json({ message: 'تم الحفظ بنجاح' });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في الحفظ' });
    }
});

// 3. تعديل (بناءً على الاسم كمثال)
app.put('/contacts', async (req, res) => {
    const { name, phone } = req.body;
    try {
        await pool.query('UPDATE contacts SET phone = $2 WHERE name = $1', [name, phone]);
        res.json({ message: 'تم التعديل بنجاح' });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في التعديل' });
    }
});

// 4. حذف
app.delete('/contacts/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM contacts WHERE name = $1', [req.params.name]);
        res.json({ message: 'تم الحذف بنجاح' });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في الحذف' });
    }
});
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// مسار إنشاء مستخدم جديد
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    // التأكد من أن المستخدم غير موجود مسبقاً
    const userCheck = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'اسم المستخدم مسجل بالفعل' });
    }

    // إدخال المستخدم الجديد (ملاحظة: في الحقيقة يجب تشفير كلمة المرور بـ bcrypt)
    await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2)',
      [username, password]
    );

    res.status(201).json({ message: 'تم إنشاء الحساب بنجاح! يمكنك الدخول الآن.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'خطأ في السيرفر' });
  }
});

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
// مسار تسجيل الدخول
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'يرجى إدخال جميع البيانات' });
    }

    try {
        const query = 'SELECT * FROM users WHERE username = $1 AND password = $2';
        const values = [username, password];
        
        const result = await pool.query(query, values);

        if (result.rows.length > 0) {
            res.status(200).json({ 
                success: true,
                message: 'تم تسجيل الدخول بنجاح يا هندسة!', 
                user: result.rows[0].username 
            });
        } else {
            res.status(401).json({ 
                success: false,
                message: 'اسم المستخدم أو كلمة المرور غير صحيحة' 
            });
        }
    } catch (err) {
        console.error('Database Error:', err.message);
        res.status(500).json({ message: 'خطأ في الاتصال بقاعدة البيانات' });
    }
});

// اختبار حالة السيرفر والقاعدة
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT NOW()');
        res.send('Server is Up and Database is Connected! 🚀');
    } catch (err) {
        res.status(500).send('Database connection failed!');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});















/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// const express = require('express');
// const cors = require('cors');
// const path = require('path'); // نحتاجه إذا أردت دمج الفرونت مع الباك
// const app = express();
// const pool = require('./db');


// // 1. جعل البورت ديناميكي (يقرأ من بيئة الاستضافة أو يستخدم 5000 كاحتياطي)
// const PORT = process.env.PORT || 5000;

// app.use(cors());
// app.use(express.json());

// app.post('/login', (req, res) => {
//     const { username, password } = req.body;
    
//     if (username === 'x' && password === '123') {
//         res.status(200).json({ message: 'تم تسجيل الدخول ياماجد!', user: username });



// // مثال لجلب بيانات من جدول المستخدمين
// app.get('/users', async (req, res) => {
//   try {
//     const result = await pool.query('SELECT * FROM users');
//     res.json(result.rows);
//   } catch (err) {
//     console.error(err.message);
//     res.status(500).send('Server Error');
//   }
// });

// app.listen(3000, () => {
//   console.log('Server is running on port 3000');
// });

//     } else {
//         res.status(401).json({ message: 'اسم المستخدم وكلمة المرور غير صحيحة' });
//     }
// });

// // رسالة بسيطة للتأكد أن السيرفر يعمل عند فتح الرابط
// app.get('/', (req, res) => {
//     res.send('Server is running successfully!');
// });

// app.listen(PORT, () => {
//     console.log(`Server is running on port ${PORT}`);
// });
















//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// const express = require('express');
// const cors = require('cors');
// const app = express();
// const PORT = 5000;

// // Middleware
// app.use(cors()); // يسمح للمتصفح بالوصول للـ API من دومين مختلف (React)
// app.use(express.json()); // يسمح للخادم بقراءة البيانات المرسلة بصيغة JSON

// // المسار (Route) الخاص بتسجيل الدخول
// app.post('/login', (req, res) => {
//     // استخراج اسم المستخدم وكلمة المرور من الطلب (Request Body)
//     const { username, password } = req.body;

//     console.log(`Try lo ${username}`);

//     // هنا نقوم بعمل فحص بسيط (في الواقع يتم الفحص مع قاعدة البيانات)
//     if (username === 'x' && password === '123') {
//         res.status(200).json({ message: 'تم تسجيل الدخول بنجاح!', user: username });
//     } else {
//         res.status(401).json({ message: 'اسم المستخدم وكلمة المرور غير صحيحة' });
//     }
// });

// app.listen(PORT, () => {
//     console.log(`الخادم يعمل على الرابط: http://localhost:${PORT}`);
// });