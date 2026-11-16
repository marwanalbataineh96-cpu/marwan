
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

app.use(express.json({ limit: "1mb" }));

// واجهة الموقع
app.use(express.static(__dirname));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "السيرفر يعمل" });
});

// إرسال سؤال الطالب إلى Gemini من الخادم حتى لا تظهر كلمة API في المتصفح
app.post("/api/ask", async (req, res) => {
  try {
    const question = typeof req.body?.question === "string"
      ? req.body.question.trim()
      : "";

    if (!question) {
      return res.status(400).json({ error: "اكتب سؤالك أولاً." });
    }

    if (question.length > 5000) {
      return res.status(400).json({ error: "السؤال طويل جداً. اختصره وحاول مرة أخرى." });
    }

    if (!API_KEY) {
      return res.status(500).json({
        error: "مفتاح الذكاء الاصطناعي غير مضبوط على السيرفر. أضف GEMINI_API_KEY إلى متغيرات البيئة."
      });
    }

    const googleResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{
              text: "أنت مساعد تعليمي عربي لموقع مروان. اشرح للطلاب بأسلوب واضح ومناسب لأعمارهم، وبالعربية السهلة. ساعدهم على الفهم خطوة بخطوة، ولا تختلق معلومات. إذا كان السؤال دراسياً فقدم إجابة منظمة وأمثلة عند الحاجة."
            }]
          },
          contents: [{
            role: "user",
            parts: [{ text: question }]
          }]
        })
      }
    );

    const data = await googleResponse.json();

    if (!googleResponse.ok) {
      console.error("Gemini API error:", data);
      return res.status(502).json({
        error: "لم أتمكن من الحصول على إجابة الآن. تحقق من مفتاح API واسم النموذج ثم حاول مجدداً."
      });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!answer) {
      return res.status(502).json({ error: "وصل رد فارغ. حاول صياغة السؤال بطريقة أخرى." });
    }

    res.json({ answer });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: "حدث خطأ في السيرفر. حاول مرة أخرى." });
  }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`موقع مروان يعمل على http://localhost:${PORT}`);
});
