# نظام إدارة الموظفين

## التشغيل
1. أنشئ مشروع Firebase وفعّل **Authentication (Email/Password)** و **Firestore**.
2. حط بيانات المشروع في `js/firebase-config.js`.
3. شغّل الملفات عبر سيرفر (Live Server أو `firebase deploy`) — لن تعمل بفتح الملف مباشرة لأنها ES Modules.

## أول أدمن
- من Firebase Console > Authentication أضف مستخدم: `admin@hr.local` وباسورد.
- في Firestore أنشئ document في collection `users` بنفس UID المستخدم:
  `{ name: "المدير", username: "admin", role: "admin", active: true }`
- سجّل دخول باسم المستخدم `admin`، ومن هناك أنشئ حسابات الموظفين.

## Firestore Rules
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function isAdmin() { return get(/databases/$(db)/documents/users/$(request.auth.uid)).data.role == 'admin'; }
    match /users/{id} {
      allow read: if request.auth != null && (request.auth.uid == id || isAdmin());
      allow write: if isAdmin();
    }
    match /settings/{id} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }
    match /attendance/{id} {
      allow read: if request.auth != null && (isAdmin() || resource.data.uid == request.auth.uid);
      allow write: if isAdmin();
    }
    match /adjustments/{id} {
      allow read: if request.auth != null && (isAdmin() || resource.data.uid == request.auth.uid);
      allow write: if isAdmin();
    }
  }
}
```

## طريقة الحساب
- **بالشهر:** المرتب − (المرتب ÷ 30 × أيام الغياب) + الإضافي + المكافآت − الخصومات.
- **باليومية:** (أيام الحضور × اليومية) + الإضافي + المكافآت − الخصومات.
- **الإضافي:** ساعات × سعر الساعة الإضافي، ولو مش محدد يُحسب تلقائياً = (اليومية ÷ ساعات العمل) × 1.5.
