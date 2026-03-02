const express = require('express');
const cors = require('cors');
const path = require('path'); // نحتاجه إذا أردت دمج الفرونت مع الباك
const app = express();

// 1. جعل البورت ديناميكي (يقرأ من بيئة الاستضافة أو يستخدم 5000 كاحتياطي)
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'x' && password === '123') {
        res.status(200).json({ message: 'تم تسجيل الدخول بنجاح يابطل!', user: username });
    } else {
        res.status(401).json({ message: 'اسم المستخدم وكلمة المرور غير صحيحة' });
    }
});

// رسالة بسيطة للتأكد أن السيرفر يعمل عند فتح الرابط
app.get('/', (req, res) => {
    res.send('Server is running successfully!');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
















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