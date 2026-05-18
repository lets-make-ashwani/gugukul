const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const Test = require("../models/Test");
const Result = require("../models/Result");
// ✅ Import nodemailer directly (Bypassed the problematic mailer.js file)
const nodemailer = require("nodemailer");

const authUser = process.env.EMAIL_USER || process.env.SMTP_LOGIN || process.env.SMTP_Login;
const authPass = process.env.EMAIL_PASS || process.env.SMTP_KEY || process.env.SMTP_Key;

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // Force SSL/TLS connection
  auth: {
    user: authUser,
    pass: authPass,
  },
  tls: {
    rejectUnauthorized: false // Bypasses strict cloud firewall SSL checks
  },
  connectionTimeout: 10000, // Fail fast in 10 seconds instead of hanging for 2 minutes
  socketTimeout: 15000,
});

// Helper Function: Calculate dynamic percentile ranking
const getPercentileData = async (testId, score) => {
  if (!testId) return { percentileRank: 'N/A', totalParticipants: 0 };
  const totalParticipants = await Result.countDocuments({ testId });
  const belowOrEqual = await Result.countDocuments({ testId, score: { $lte: score } });
  const percentileRank = totalParticipants > 0 ? Math.round((belowOrEqual / totalParticipants) * 100) : 100;
  return { percentileRank, totalParticipants };
};

// ================= SUBMIT RESULT =================
exports.submitResult = async (req, res) => {
  try {
    const {
      testId,
      answers,
      studentName,
      studentEmail,
      studentFields,
      studentPhone,
      studentRoll,
      violations
    } = req.body;

    console.log("BODY:", req.body);

    // ================= VALIDATION =================
    if (!testId || !answers) {
      return res.status(400).json({
        msg: "Test ID and answers required ❌"
      });
    }

    if (!studentEmail) {
      return res.status(400).json({
        msg: "Student Email required ❌"
      });
    }

    // ================= FIND TEST =================
    const test = await Test.findById(testId);

    if (!test) {
      return res.status(404).json({
        msg: "Test not found ❌"
      });
    }

    // ================= PREVENT REATTEMPT =================
    const existing = await Result.findOne({
      testId: test._id,
      studentEmail
    });

    if (existing) {
      return res.status(400).json({
        msg: "Already attempted ❌"
      });
    }

    // ================= SCORE CALC =================
    let sectionResults = [];   
    let score = 0;
    let totalQuestions = 0;
    let writtenAnswers = [];

    (test.sections || []).forEach((section, secIndex) => {

    let sectionScore = 0;
    let sectionTotal = 0;

    let sectionCorrect = 0;
    let sectionWrong = 0;
    let sectionTotalMCQ = 0;
    let sectionWritten = 0;

  const qs = section.questions || [];

qs.forEach((q, qIndex) => {

  // ✅ SKIP WRITTEN QUESTIONS
  if (q.type === "written") {
    sectionWritten++;

  const key = `${secIndex}-${qIndex}`;

  writtenAnswers.push({

    section: section.name,

    question: q.q,

    answer: answers[key] || "Not Answered"

  });

  return;
}

  sectionTotalMCQ++;
  totalQuestions++;

  sectionTotal += test.marksCorrect || 4;

  const key = `${secIndex}-${qIndex}`;

  const ans = answers[key];

  // ✅ unanswered = no negative
  if (!ans) return;

  // ✅ correct answer
  if (ans === q.correct) {

    score += test.marksCorrect || 4;

    sectionScore += test.marksCorrect || 4;

    sectionCorrect++;

  }

  // ✅ wrong answer
  else {

    score -= test.marksNegative || 1;

    sectionScore -= test.marksNegative || 1;

    sectionWrong++;

  }

});

if (qs.length === 0) return; // Don't add empty sections to results

sectionResults.push({

  sectionName: section.name,

  correct: sectionCorrect,

  wrong: sectionWrong,

  total: sectionTotalMCQ,

  score: sectionScore,
  written: sectionWritten

});

});

    // ================= TOTAL =================
    const totalMarks = totalQuestions * (test.marksCorrect || 4);

    const percentage =
      totalMarks > 0
        ? Math.round((score / totalMarks) * 100)
        : 0;


    // ================= SAVE RESULT =================
  const result = await Result.create({

  testId: test._id,

  testName: test.title,

  studentName:
    studentName ||
    studentFields?.name ||
    "",

  studentEmail:
    studentEmail ||
    studentFields?.email ||
    "",

  studentPhone:
    studentPhone ||
    studentFields?.phone ||
    "",

  studentRoll:
    studentRoll ||
    studentFields?.rollno ||
    "",

  studentFields,

  answers,

  score,

  total: totalMarks,

  percentage,

  sectionResults,

  writtenAnswers,
  violations,
  isPublished: true

});

    res.status(201).json(result);

  } catch (err) {
    console.error("RESULT ERROR:", err);

    res.status(500).json({
      msg: "Server Error ❌",
      error: err.message
    });
  }
};



// ================= GET ALL RESULTS =================
exports.getAllResults = async (req, res) => {
  try {
    const { testId } = req.query;

    let filter = {};
    if (testId) filter.testId = testId;

    const results = await Result.find(filter)
      .populate("testId", "title") // ✅ IMPORTANT
      .sort({ createdAt: -1 })
      .lean(); // ✅ Bypasses Mongoose strict schema filtering to show new fields

    res.json(results);

  } catch (err) {
    console.error("GET RESULTS ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};


// ================= GET RESULT BY ID =================
exports.getResultById = async (req, res) => {
  try {
    // ✅ Secure Workaround: Allows students to download PDF/Excel directly through the view route
    if (req.query.export === 'pdf') {
      return exports.exportStudentPDF(req, res);
    }
    if (req.query.export === 'excel') {
      return exports.exportStudentExcel(req, res);
    }

    const result = await Result.findById(req.params.id)
      .populate("testId")
      .lean(); // ✅ Bypasses Mongoose strict schema filtering to show new fields

    if (!result) {
      return res.status(404).json({
        msg: "Result not found ❌"
      });
    }
    
    // Dynamically calculate percentile
    if (result.testId) {
      const { percentileRank, totalParticipants } = await getPercentileData(result.testId._id, result.score);
      result.percentileRank = percentileRank;
      result.totalParticipants = totalParticipants;
    }

    res.json(result);

  } catch (err) {
    console.error("GET RESULT ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};


// ================= DELETE RESULT =================
exports.deleteResult = async (req, res) => {
  try {
    const result = await Result.findByIdAndDelete(req.params.id);

    if (!result) {
      return res.status(404).json({
        msg: "Result not found ❌"
      });
    }

    res.json({
      msg: "Result deleted successfully ✅"
    });

  } catch (err) {
    console.error("DELETE RESULT ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};


// ================= GET MY RESULTS =================
exports.getMyResults = async (req, res) => {
  try {
    const results = await Result.find({
      studentEmail: req.user?.email,
      isPublished: { $ne: false }
    })
      .populate("testId", "title")
      .sort({ createdAt: -1 });

    res.json(results);

  } catch (err) {
    console.error("MY RESULTS ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};


// ================= GET TEST LIST FROM RESULTS =================
exports.getTestsFromResults = async (req, res) => {
  try {
    const results = await Result.find();

    const testIds = results
      .map(r => r.testId)
      .filter(Boolean);

    const uniqueIds = [...new Set(testIds.map(id => id.toString()))];

    const tests = await Test.find({
      _id: { $in: uniqueIds }
    });

    res.json(tests);

  } catch (err) {
    console.error("TEST LIST ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};
// ================= EXPORT PDF =================
exports.exportPDF = async (req, res) => {

  try {

    const filter = {};

if (
  req.query.test &&
  req.query.test !== "all"
) {
  filter.testName = req.query.test;
}

const results = await Result.find(filter)
      .populate("testId", "title")
      .sort({ createdAt: -1 });

    const doc = new PDFDocument({ margin: 30 });

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=results.pdf"
    );

    doc.pipe(res);

    doc
      .fontSize(20)
      .text("Student Results Report", {
        align: "center"
      });

    doc.moveDown();

    results.forEach((r, i) => {

      doc
        .fontSize(12)
        .text(
          `${i + 1}. ${r.studentName}`
        );

      doc.text(`Email: ${r.studentEmail}`);

      doc.text(
        `Test: ${r.testId?.title || r.testName}`
      );

      doc.text(
        `Score: ${r.score}/${r.total}`
      );

      doc.text(
        `Percentage: ${r.percentage}%`
      );

      if (r.sectionResults && r.sectionResults.length > 0) {
        const secText = r.sectionResults.map(s => {
          const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
          return `${s.sectionName}: ${s.correct}/${s.total} (${pct}%)` + (s.written ? `, ${s.written} Written` : "");
        }).join("  |  ");
        doc.fontSize(10).text(`Section Details: ${secText}`);
        doc.fontSize(12);
      }

      doc.text(
        `Date: ${new Date(
          r.createdAt
        ).toLocaleDateString()}`
      );

      // ✅ Explicit Primary Fields
      const course = r.studentFields?.course || r.studentFields?.Course;
      const branch = r.studentFields?.branch || r.studentFields?.Branch;
      const section = r.studentFields?.section || r.studentFields?.Section;

      if (course) doc.text(`Course: ${course}`);
      if (branch) doc.text(`Branch: ${branch}`);
      if (section) doc.text(`Section: ${section}`);

      doc.text(`Tab Switches: ${r.violations?.tabSwitches || 0}`);

      doc.moveDown();

    });

    doc.end();

  } catch (err) {

    console.error("PDF EXPORT ERROR:", err);

    res.status(500).json({
      msg: "PDF export failed ❌"
    });

  }

};
// ================= EXPORT EXCEL =================
exports.exportExcel = async (req, res) => {

  try {

    const workbook = new ExcelJS.Workbook();

    const worksheet =
      workbook.addWorksheet("Results");

    const columns = [

      {
        header: "Student Name",
        key: "studentName",
        width: 25
      },

      {
        header: "Email",
        key: "studentEmail",
        width: 30
      },

      {
        header: "Roll",
        key: "studentRoll",
        width: 15
      },

      {
        header: "Phone",
        key: "studentPhone",
        width: 20
      }

    ];

    const filter = {};

if (
  req.query.test &&
  req.query.test !== "all"
) {
  filter.testName = req.query.test;
}

const results = await Result.find(filter)
      .populate("testId", "title")
      .sort({ createdAt: -1 });

    const hasCourse = results.some(r => r.studentFields?.course || r.studentFields?.Course);
    const hasBranch = results.some(r => r.studentFields?.branch || r.studentFields?.Branch);
    const hasSection = results.some(r => r.studentFields?.section || r.studentFields?.Section);

    if (hasCourse) columns.push({ header: "Course", key: "course", width: 15 });
    if (hasBranch) columns.push({ header: "Branch", key: "branch", width: 15 });
    if (hasSection) columns.push({ header: "Section", key: "section", width: 15 });

    columns.push(
      { header: "Test", key: "testName", width: 30 },
      { header: "Score", key: "score", width: 15 },
      { header: "Percentage", key: "percentage", width: 15 },
      { header: "Total MCQs", key: "totalMCQs", width: 15 },
      { header: "Correct", key: "correct", width: 15 },
      { header: "Wrong", key: "wrong", width: 15 },
      { header: "Unattempted", key: "unattempted", width: 15 },
      { header: "Section Details", key: "sectionResults", width: 80 },
      { header: "Tab Switches", key: "tabSwitches", width: 15 },
      { header: "Date", key: "date", width: 20 }
    );

    worksheet.columns = columns;

    results.forEach((r) => {
      const totalCorrect = r.sectionResults?.reduce((acc, sec) => acc + (sec.correct || 0), 0) || 0;
      const totalWrong = r.sectionResults?.reduce((acc, sec) => acc + (sec.wrong || 0), 0) || 0;
      const totalMCQs = r.sectionResults?.reduce((acc, sec) => acc + (sec.total || 0), 0) || 0;
      const unattempted = Math.max(0, totalMCQs - totalCorrect - totalWrong);

      let rowData = {

        studentName: r.studentName,

        studentEmail: r.studentEmail,

        studentRoll: r.studentRoll,

        studentPhone: r.studentPhone,

        course: r.studentFields?.course || r.studentFields?.Course || "N/A",
        branch: r.studentFields?.branch || r.studentFields?.Branch || "N/A",
        section: r.studentFields?.section || r.studentFields?.Section || "N/A",

        testName:
          r.testId?.title || r.testName,

        score: `${r.score}/${r.total}`,

        percentage: `${r.percentage}%`,

        totalMCQs: totalMCQs,
        correct: totalCorrect,
        wrong: totalWrong,
        unattempted: unattempted,

        sectionResults: r.sectionResults && r.sectionResults.length > 0 ? r.sectionResults.map(s => {
            const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
            return `${s.sectionName}: ${s.correct}/${s.total} (${pct}%)` + (s.written ? ` | ${s.written} Written` : "");
        }).join("  ||  ") : "N/A",

        tabSwitches: r.violations?.tabSwitches || 0,

        date: new Date(
          r.createdAt
        ).toLocaleDateString()

      };

      worksheet.addRow(rowData);

    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=results.xlsx"
    );

    await workbook.xlsx.write(res);

    res.end();

  } catch (err) {

    console.error(
      "EXCEL EXPORT ERROR:",
      err
    );

    res.status(500).json({
      msg: "Excel export failed ❌"
    });

  }

};
exports.exportStudentPDF = async (req, res) => {

  try {

    const result = await Result.findById(
      req.params.id
    );

    if (!result) {

      return res.status(404).json({
        msg: "Result not found"
      });

    }

    let test = null;
    if (result.testId) {
      test = await Test.findById(result.testId);
    }

    const doc = new PDFDocument();

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="student_result.pdf"`
    );

    doc.pipe(res);

    // ================= HEADER =================

    doc
      .fontSize(24)
      .text("Student Result Report", {
        align: "center"
      });

    doc.moveDown();

    // ================= STUDENT INFO =================

    doc.fontSize(14);

    doc.text(
      `Student Name: ${result.studentName}`
    );

    doc.text(
      `Email: ${result.studentEmail}`
    );

    doc.text(
      `Roll Number: ${result.studentRoll}`
    );

    doc.text(
      `Phone: ${result.studentPhone}`
    );

    doc.text(
      `Test Name: ${result.testName}`
    );

    doc.text(
      `Score: ${result.score}`
    );

    doc.text(
      `Percentage: ${result.percentage}%`
    );
    const { percentileRank, totalParticipants } = await getPercentileData(result.testId, result.score);
    doc.text(`Percentile Rank: ${percentileRank}% (Out of ${totalParticipants} Students)`);

    doc.moveDown();

    // ================= PRIMARY STUDENT DETAILS =================
    const course = result.studentFields?.course || result.studentFields?.Course;
    const branch = result.studentFields?.branch || result.studentFields?.Branch;
    const section = result.studentFields?.section || result.studentFields?.Section;

    if (course) doc.text(`Course: ${course}`);
    if (branch) doc.text(`Branch: ${branch}`);
    if (section) doc.text(`Section: ${section}`);
    if (course || branch || section) doc.moveDown();

    // ================= PERFORMANCE OVERVIEW =================
    const totalCorrect = result.sectionResults?.reduce((acc, sec) => acc + (sec.correct || 0), 0) || 0;
    const totalWrong = result.sectionResults?.reduce((acc, sec) => acc + (sec.wrong || 0), 0) || 0;
    const totalMCQs = result.sectionResults?.reduce((acc, sec) => acc + (sec.total || 0), 0) || 0;
    const unattempted = Math.max(0, totalMCQs - totalCorrect - totalWrong);

    if (totalMCQs > 0) {
      doc.moveDown(0.5);
      doc.fontSize(16).fillColor('black').text("Performance Overview", { underline: true });
      doc.moveDown(0.5);

      const barWidth = 400;
      const barHeight = 25;
      const startX = doc.x;
      let startY = doc.y;

      const wCorrect = (totalCorrect / totalMCQs) * barWidth;
      const wWrong = (totalWrong / totalMCQs) * barWidth;
      const wUnattempted = (unattempted / totalMCQs) * barWidth;

      if (wCorrect > 0) doc.rect(startX, startY, wCorrect, barHeight).fill('#16a34a');
      if (wWrong > 0) doc.rect(startX + wCorrect, startY, wWrong, barHeight).fill('#dc2626');
      if (wUnattempted > 0) doc.rect(startX + wCorrect + wWrong, startY, wUnattempted, barHeight).fill('#cbd5e1');

      doc.y = startY + barHeight + 15;
      
      // Legends
      doc.rect(startX, doc.y, 12, 12).fill('#16a34a');
      doc.fillColor('black').fontSize(12).text(`Correct: ${totalCorrect} (${((totalCorrect/totalMCQs)*100).toFixed(1)}%)`, startX + 20, doc.y - 1);
      
      doc.rect(startX + 150, doc.y - 12, 12, 12).fill('#dc2626');
      doc.fillColor('black').text(`Wrong: ${totalWrong} (${((totalWrong/totalMCQs)*100).toFixed(1)}%)`, startX + 170, doc.y - 13);
      
      doc.rect(startX + 300, doc.y - 12, 12, 12).fill('#cbd5e1');
      doc.fillColor('black').text(`Unattempted: ${unattempted} (${((unattempted/totalMCQs)*100).toFixed(1)}%)`, startX + 320, doc.y - 13);
      
      doc.moveDown(2);
    }

    // ================= SECURITY REPORT =================
    if (result.violations) {
      doc
        .fontSize(18)
        .text("Security & Monitoring Report");
      doc.moveDown();

      doc.fontSize(14);
      doc.text(`Submission Reason: ${result.violations.reason || "Normal Submission"}`);
      doc.text(`Tab Switches: ${result.violations.tabSwitches || 0} Times`);
      doc.text(`Window Minimized (Alt+Tab): ${result.violations.windowBlurs || 0} Times`);
      doc.text(`Camera Violations: ${result.violations.cameraViolations || 0} Times`);
      doc.text(`Illegal Scrolls: ${result.violations.scrolls || 0} Times`);
      
      if (result.violations.noiseViolations !== undefined) {
        doc.text(`Mic/Noise Violations: ${result.violations.noiseViolations} Times`);
      }
      doc.moveDown();
    }

    // ================= SECTION DETAILS =================

    if (result.sectionResults?.length) {

      doc
        .fontSize(18)
        .text("Section Performance");

      doc.moveDown();

      result.sectionResults.forEach(
        (section, index) => {

          doc.fontSize(14);

          const secPct = section.total > 0 ? Math.round((section.correct / section.total) * 100) : 0;

          doc.text(
            `${index + 1}. ${section.sectionName} (${secPct}%)`
          );

          doc.text(
            `Correct: ${section.correct}`
          );

          doc.text(
            `Wrong: ${section.wrong}`
          );

          doc.text(
            `Unattempted: ${Math.max(0, (section.total || 0) - (section.correct || 0) - (section.wrong || 0))}`
          );

          doc.text(
            `Score: ${section.score}`
          );

          doc.text(
            `MCQs Total: ${section.total}`
          );
          if (section.written > 0) {
            doc.text(`Written Qs: ${section.written}`);
          }

          doc.moveDown();

        }
      );

    }

    // ================= WRITTEN ANSWERS =================

    if (result.writtenAnswers?.length) {

      doc
        .fontSize(18)
        .text("Written Answers");

      doc.moveDown();

      result.writtenAnswers.forEach(
        (q, index) => {

          doc.fontSize(14);

          doc.text(
            `Q${index + 1}: ${q.question}`
          );

          doc.text(
            `Answer: ${q.answer}`
          );

          doc.moveDown();

        }
      );

    }

    // ================= DETAILED MCQ ANSWERS =================
    if (test && test.sections) {
      doc.addPage();
      doc.fontSize(18).fillColor('black').text("Detailed Answers Report", { align: "center" });
      doc.moveDown();

      test.sections.forEach((sec, secIndex) => {
        const mcqs = (sec.questions || []).filter(q => q.type !== 'written');
        
        if (mcqs.length > 0) {
          doc.fontSize(14).fillColor('black').text(`Section: ${sec.name}`, { underline: true });
          doc.moveDown(0.5);

          (sec.questions || []).forEach((q, qIndex) => {
            if (q.type === 'written') return;
            
            const key = `${secIndex}-${qIndex}`;
            const chosen = result.answers ? result.answers[key] : null;
            const isCorrect = chosen === q.correct;

            doc.fontSize(12).fillColor('black').text(`Q: ${q.q}`);

            if (q.options) {
              doc.moveDown(0.3);
              Object.entries(q.options).forEach(([k, v]) => {
                if (k === q.correct) {
                  doc.fillColor('green').text(`  ${k}. ${v} [Correct Answer]`);
                } else if (chosen === k && chosen !== q.correct) {
                  doc.fillColor('red').text(`  ${k}. ${v} [Your Answer]`);
                } else {
                  doc.fillColor('black').text(`  ${k}. ${v}`);
                }
              });
            }

            doc.moveDown(0.5);
            if (chosen) {
              doc.fillColor(isCorrect ? 'green' : 'red').text(`Your Answer: ${chosen} ${isCorrect ? '(Correct)' : '(Wrong)'}`);
            } else {
              doc.fillColor('gray').text(`Your Answer: Not Attempted`);
            }
            doc.moveDown(1);
          });
          doc.moveDown();
        }
      });
      doc.fillColor('black');
    }

    doc.end();

  } catch (err) {

    console.log(err);

    res.status(500).json({
      msg: "PDF Export Failed"
    });

  }

};
exports.exportStudentExcel = async (
  req,
  res
) => {

  try {

    const result = await Result.findById(
      req.params.id
    );

    if (!result) {

      return res.status(404).json({
        msg: "Result not found"
      });

    }

    // ✅ Fetch test to get questions for detailed answers
    let test = null;
    if (result.testId) {
      test = await Test.findById(result.testId);
    }

    const workbook = new ExcelJS.Workbook();

    const sheet =
      workbook.addWorksheet(
        "Student Result"
      );

    // ================= BASIC INFO =================

    sheet.columns = [

      {
        header: "Field",
        key: "field",
        width: 30
      },

      {
        header: "Value",
        key: "value",
        width: 50
      }

    ];

    sheet.addRow({
      field: "Student Name",
      value: result.studentName
    });

    sheet.addRow({
      field: "Email",
      value: result.studentEmail
    });

    sheet.addRow({
      field: "Roll",
      value: result.studentRoll
    });

    sheet.addRow({
      field: "Phone",
      value: result.studentPhone
    });

    sheet.addRow({
      field: "Test",
      value: result.testName
    });

    sheet.addRow({
      field: "Score",
      value: result.score
    });

    sheet.addRow({
      field: "Percentage",
      value: `${result.percentage}%`
    });

    const course = result.studentFields?.course || result.studentFields?.Course;
    const branch = result.studentFields?.branch || result.studentFields?.Branch;
    const section = result.studentFields?.section || result.studentFields?.Section;

    const totalCorrect = result.sectionResults?.reduce((acc, sec) => acc + (sec.correct || 0), 0) || 0;
    const totalWrong = result.sectionResults?.reduce((acc, sec) => acc + (sec.wrong || 0), 0) || 0;
    const totalMCQs = result.sectionResults?.reduce((acc, sec) => acc + (sec.total || 0), 0) || 0;
    const unattempted = Math.max(0, totalMCQs - totalCorrect - totalWrong);
    
    const pctCorrect = totalMCQs > 0 ? ((totalCorrect / totalMCQs) * 100).toFixed(1) : 0;
    const pctWrong = totalMCQs > 0 ? ((totalWrong / totalMCQs) * 100).toFixed(1) : 0;
    const pctUnattempted = totalMCQs > 0 ? ((unattempted / totalMCQs) * 100).toFixed(1) : 0;

    sheet.addRow({ field: "Total MCQs", value: totalMCQs });
    sheet.addRow({ field: "Correct Answers", value: `${totalCorrect} (${pctCorrect}%)` });
    sheet.addRow({ field: "Wrong Answers", value: `${totalWrong} (${pctWrong}%)` });
    sheet.addRow({ field: "Unattempted", value: `${unattempted} (${pctUnattempted}%)` });
    
    const { percentileRank, totalParticipants } = await getPercentileData(result.testId, result.score);
    sheet.addRow({ field: "Percentile Rank", value: `${percentileRank}% (Top ${(100 - percentileRank) || 1}% of ${totalParticipants} Students)` });

    if (course) {
      sheet.addRow({ field: "Course", value: course });
    }
    if (branch) {
      sheet.addRow({ field: "Branch", value: branch });
    }
    if (section) {
      sheet.addRow({ field: "Section", value: section });
    }

    // ================= SECURITY REPORT =================
    if (result.violations) {
      sheet.addRow({});
      sheet.addRow({
        field: "SECURITY & MONITORING REPORT"
      });

      sheet.addRow({
        field: "Submission Reason",
        value: result.violations.reason || "Normal Submission"
      });
      sheet.addRow({
        field: "Tab Switches",
        value: `${result.violations.tabSwitches || 0} Times`
      });
      sheet.addRow({
        field: "Window Minimized",
        value: `${result.violations.windowBlurs || 0} Times`
      });
      sheet.addRow({
        field: "Camera Violations",
        value: `${result.violations.cameraViolations || 0} Times`
      });
      sheet.addRow({
        field: "Illegal Scrolls",
        value: `${result.violations.scrolls || 0} Times`
      });
      if (result.violations.noiseViolations !== undefined) {
        sheet.addRow({
          field: "Mic/Noise Violations",
          value: `${result.violations.noiseViolations} Times`
        });
      }
    }

    // ================= SECTION DATA =================

    if (result.sectionResults?.length) {

      sheet.addRow({});
      sheet.addRow({
        field: "SECTION RESULTS"
      });

      result.sectionResults.forEach(
        section => {

          sheet.addRow({
            field:
  `Section: ${section.sectionName} (${section.total > 0 ? Math.round((section.correct / section.total) * 100) : 0}%)`,
          
              value:
              `Correct: ${section.correct || 0}
              | Wrong: ${section.wrong || 0}
              | Unattempted: ${Math.max(0, (section.total || 0) - (section.correct || 0) - (section.wrong || 0))}
              | MCQs: ${section.total || 0}
              | Score: ${section.score || 0}
              ${section.written ? `| Written: ${section.written}` : ''}`
          });

        }
      );

    }

    // ================= WRITTEN ANSWERS =================

    if (result.writtenAnswers?.length) {

      sheet.addRow({});
      sheet.addRow({
        field: "WRITTEN ANSWERS"
      });

      result.writtenAnswers.forEach(
        q => {

          sheet.addRow({
            field: q.question,
            value: q.answer
          });

        }
      );

    }

    // ================= DETAILED MCQ ANSWERS =================
    if (test && test.sections) {
      sheet.addRow({});
      sheet.addRow({ field: "DETAILED MCQ ANSWERS" });

      test.sections.forEach((sec, secIndex) => {
        (sec.questions || []).forEach((q, qIndex) => {
          if (q.type === 'written') return;
          
          const key = `${secIndex}-${qIndex}`;
          const chosen = result.answers ? result.answers[key] : null;
          const isCorrect = chosen === q.correct;

          const optionsStr = q.options ? `A: ${q.options.A}, B: ${q.options.B}, C: ${q.options.C}, D: ${q.options.D}` : '';

          sheet.addRow({
            field: `[${sec.name}] Q: ${q.q}`,
            value: `Options: [${optionsStr}] \nSelected: ${chosen || 'Not Attempted'} \nCorrect: ${q.correct} \nStatus: ${chosen ? (isCorrect ? 'Correct' : 'Wrong') : 'N/A'}`
          });
        });
      });
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="student_result.xlsx"`
    );

    await workbook.xlsx.write(res);

    res.end();

  } catch (err) {

    console.log(err);

    res.status(500).json({
      msg: "Excel Export Failed"
    });

  }

};

// ================= HELPER: GENERATE COMPREHENSIVE EMAIL HTML =================
const generateEmailHTML = (result, test) => {
  const studentNameDisplay = result.studentName || result.studentFields?.name || 'Student';
  const studentEmailDisplay = result.studentEmail || result.studentFields?.email || '-';
  const studentRollDisplay = result.studentRoll || result.studentFields?.roll || result.studentFields?.rollno || '-';
  const studentPhoneDisplay = result.studentPhone || result.studentFields?.phone || result.studentFields?.Phone || result.studentFields?.phoneno || '-';

  const isPass = result.percentage >= 50;
  let html = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 800px; margin: 0 auto; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px;">
      <h2 style="color: #1e3a8a; text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-top: 0;">Exam Result Details</h2>
      <p style="font-size: 16px;">Hello <strong>${studentNameDisplay}</strong>,</p>
      <p style="font-size: 16px;">Here is the comprehensive report for your recent mock test.</p>
      
      <h3 style="background: #f1f5f9; padding: 12px; border-radius: 6px; color: #0f172a; margin-top: 25px;">📝 Test Information</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Student Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${studentNameDisplay}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Student Email:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${studentEmailDisplay}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Student Roll:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${studentRollDisplay}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Student Phone:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${studentPhoneDisplay}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Test Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${result.testName}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Score:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${result.score} / ${result.total}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Percentage:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${result.percentage}%</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Percentile Rank:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${result.percentileRank || 'N/A'}%</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Status:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: ${isPass ? 'green' : 'red'}; font-weight: bold;">${isPass ? 'PASS' : 'FAIL'}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Submission Reason:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${result.violations?.reason || 'Normal Submission'}</td></tr>
      </table>
  `;

  if (result.violations) {
    html += `
      <h3 style="background: #fef2f2; padding: 12px; border-radius: 6px; color: #991b1b;">🛡️ Security & Monitoring Report</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #fecaca;"><strong>Tab Switches:</strong></td><td style="padding: 8px; border-bottom: 1px solid #fecaca; color: ${result.violations.tabSwitches > 0 ? 'red' : 'green'};">${result.violations.tabSwitches || 0} Times</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #fecaca;"><strong>Window Minimized:</strong></td><td style="padding: 8px; border-bottom: 1px solid #fecaca; color: ${result.violations.windowBlurs > 0 ? 'red' : 'green'};">${result.violations.windowBlurs || 0} Times</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #fecaca;"><strong>Camera Violations:</strong></td><td style="padding: 8px; border-bottom: 1px solid #fecaca; color: ${result.violations.cameraViolations > 0 ? 'red' : 'green'};">${result.violations.cameraViolations || 0} Times</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #fecaca;"><strong>Illegal Scrolls:</strong></td><td style="padding: 8px; border-bottom: 1px solid #fecaca; color: ${result.violations.scrolls > 0 ? 'red' : 'green'};">${result.violations.scrolls || 0} Times</td></tr>
        ${result.violations.noiseViolations !== undefined ? `<tr><td style="padding: 8px; border-bottom: 1px solid #fecaca;"><strong>Mic / Noise Violations:</strong></td><td style="padding: 8px; border-bottom: 1px solid #fecaca; color: ${result.violations.noiseViolations > 0 ? 'red' : 'green'};">${result.violations.noiseViolations} Times</td></tr>` : ''}
      </table>
    `;
  }

  if (result.sectionResults && result.sectionResults.length > 0) {
    html += `
      <h3 style="background: #f0fdf4; padding: 12px; border-radius: 6px; color: #166534;">📊 Section Wise Result</h3>
      <table style="width: 100%; border-collapse: collapse; text-align: left; margin-bottom: 30px;">
        <thead>
          <tr style="background: #e2e8f0; color: #334155;">
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Section</th>
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Accuracy</th>
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Correct</th>
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Wrong</th>
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Unattempted</th>
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Score</th>
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Total MCQs</th>
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Written Qs</th>
          </tr>
        </thead>
        <tbody>
    `;
    result.sectionResults.forEach(sec => {
      const secUnattempted = Math.max(0, (sec.total || 0) - (sec.correct || 0) - (sec.wrong || 0));
      const secPct = sec.total > 0 ? ((sec.correct / sec.total) * 100).toFixed(1) : 0;
      html += `
          <tr>
            <td style="padding: 10px; border: 1px solid #cbd5e1;">${sec.sectionName}</td>
            <td style="padding: 10px; border: 1px solid #cbd5e1;"><strong>${secPct}%</strong></td>
            <td style="padding: 10px; border: 1px solid #cbd5e1;">${sec.correct}</td>
            <td style="padding: 10px; border: 1px solid #cbd5e1;">${sec.wrong}</td>
            <td style="padding: 10px; border: 1px solid #cbd5e1;">${secUnattempted}</td>
            <td style="padding: 10px; border: 1px solid #cbd5e1;">${sec.score}</td>
            <td style="padding: 10px; border: 1px solid #cbd5e1;">${sec.total}</td>
            <td style="padding: 10px; border: 1px solid #cbd5e1;">${sec.written || 0}</td>
          </tr>
      `;
    });
    html += `</tbody></table>`;
  }

  if (test && test.sections) {
    html += `<h3 style="background: #f8fafc; padding: 12px; border-radius: 6px; color: #0f172a; margin-top: 30px;">📖 Detailed Answers</h3>`;
    test.sections.forEach((sec, secIndex) => {
      const mcqQuestions = sec.questions.filter(q => q.type !== 'written');
      const writtenQuestions = sec.questions.filter(q => q.type === 'written');
      
      if (mcqQuestions.length > 0 || writtenQuestions.length > 0) {
        html += `<h4 style="color: #334155; margin-top: 25px; border-bottom: 2px solid #eef1f8; padding-bottom: 5px;">Section: ${sec.name}</h4>`;
      }

      sec.questions.forEach((q, qIndex) => {
        const key = `${secIndex}-${qIndex}`;
        const chosen = result.answers ? result.answers[key] : null;
        
        if (q.type === 'written') {
           const writtenAns = result.writtenAnswers?.find(wa => wa.question === q.q)?.answer || chosen || 'Not Answered';
           html += `
            <div style="margin-bottom: 15px; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc;">
              <p style="margin: 0 0 10px 0; font-size: 15px;"><strong>Q (Written):</strong> ${q.q}</p>
              <p style="margin: 5px 0; color: #475569;"><strong>Your Answer:</strong> ${writtenAns}</p>
            </div>
          `;
        } else {
          const isCorrect = chosen === q.correct;
          html += `
            <div style="margin-bottom: 15px; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc;">
              <p style="margin: 0 0 10px 0; font-size: 15px;"><strong>Q:</strong> ${q.q}</p>
            </div>
          `;
          
          if (q.options) {
            Object.entries(q.options).forEach(([k, v]) => {
              let bgColor = "transparent";
              let color = "#334155";
              let fw = "normal";
              let border = "1px solid #e2e8f0";
              if (k === q.correct) {
                bgColor = "#dcfce7"; color = "#166534"; fw = "bold"; border = "1px solid #22c55e";
              } else if (chosen === k && chosen !== q.correct) {
                bgColor = "#fee2e2"; color = "#991b1b"; fw = "bold"; border = "1px solid #ef4444";
              }
              html += `<div style="padding: 8px 12px; margin: 4px 0; border-radius: 6px; background-color: ${bgColor}; color: ${color}; font-weight: ${fw}; border: ${border}; display: flex; justify-content: space-between;"><span>${k}. ${v}</span><span>${k === q.correct ? "✅" : (chosen === k ? "❌" : "")}</span></div>`;
            });
          }

          html += `
              <p style="margin: 10px 0 0 0; color: ${chosen ? (isCorrect ? '#16a34a' : '#dc2626') : '#64748b'};">
                <strong>Your Answer:</strong> ${chosen || 'Not Attempted'}
              </p>
            </div>
          `;
        }
      });
    });
  } else if (result.writtenAnswers && result.writtenAnswers.length > 0) {
     html += `<h3 style="background: #f8fafc; padding: 12px; border-radius: 6px; color: #0f172a; margin-top: 30px;">📖 Written Answers</h3>`;
     result.writtenAnswers.forEach((q, index) => {
       html += `
          <div style="margin-bottom: 15px; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc;">
            <p style="margin: 0 0 10px 0; font-size: 15px;"><strong>Q${index + 1}:</strong> ${q.question}</p>
            <p style="margin: 5px 0; color: #475569;"><strong>Your Answer:</strong> ${q.answer}</p>
          </div>
       `;
     });
  }

  html += `
      <p style="margin-top: 35px; font-size: 14px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 20px;">
        This is an automated performance report. Contact your administrator for detailed feedback.<br>
        <strong>Gurukul Success Classes</strong>
      </p>
    </div>
  `;
  return html;
};

// ================= SEND SINGLE EMAIL =================
exports.emailStudentResult = async (req, res) => {
  try {
    if (!authUser || !authPass) {
      return res.status(500).json({ msg: "Server Email configuration missing in Render Environment Variables ❌" });
    }

    const result = await Result.findById(req.params.id);
    if (!result) return res.status(404).json({ msg: "Result not found" });
    
    let email = (result.studentEmail || "").toString().trim();
    if (!email || email.toLowerCase() === "guest@test.com") {
      if (result.studentFields) {
        const emailKey = Object.keys(result.studentFields).find(k => k.toLowerCase() === 'email');
        if (emailKey) {
          email = (result.studentFields[emailKey] || "").toString().trim();
        }
      }
    }

    if (!email || email.toLowerCase() === "guest@test.com" || !email.includes("@")) {
      return res.status(400).json({ msg: "No valid email address found for this student ❌" });
    }

    // Get percentile
    const { percentileRank } = await getPercentileData(result.testId, result.score);
    result.percentileRank = percentileRank;

    // Fetch Test data to include detailed Questions and Answers
    let test = null;
    if (result.testId) {
      test = await Test.findById(result.testId);
    }

    const mailOptions = {
      from: (authUser || "").trim(),
      to: email,
      subject: `Comprehensive Exam Result: ${result.testName}`,
      html: generateEmailHTML(result, test)
    };

    await transporter.sendMail(mailOptions);
    
    // ✅ Save the success status to the database
    await Result.findByIdAndUpdate(req.params.id, {
      $set: { emailStatus: 'Sent', emailSentAt: new Date(), isPublished: true }
    }, { strict: false });

    res.json({ msg: "Result emailed successfully to the student! ✅" });
  } catch (err) {
    console.error("Email Error:", err);
    // ✅ Save the failure status to the database
    if (req.params.id) {
      try {
        await Result.findByIdAndUpdate(req.params.id, { $set: { emailStatus: 'Failed', emailError: err.message } }, { strict: false });
      } catch (dbErr) {
        console.error("DB update failed during email error:", dbErr);
      }
    }
    // 🚀 BUBBLE EXACT ERROR TO THE FRONTEND ALERT!
    res.status(500).json({ msg: `Failed to send email ❌: ${err.message}` });
  }
};

// ================= SEND BULK EMAILS =================
exports.emailAllResults = async (req, res) => {
  try {
    if (!authUser || !authPass) {
      return res.status(500).json({ msg: "Server Email configuration missing in Render Environment Variables ❌" });
    }

    const { testId, testName } = req.body;
    let filter = {};
    if (testId) filter.testId = testId;
    if (testName) filter.testName = testName;

    const results = await Result.find(Object.keys(filter).length > 0 ? filter : {});
    
    // ✅ Publish all filtered results
    await Result.updateMany(Object.keys(filter).length > 0 ? filter : {}, { $set: { isPublished: true } }, { strict: false });

    // ✅ Respond immediately so the browser request doesn't timeout!
    res.json({ msg: `Publish & Email process started for ${results.length} students! ✅ This is securely running in the background.` });

    // ✅ Process emails asynchronously in the background
    (async () => {
      let sentCount = 0;
      const testCache = {}; // Cache test data to avoid repeating DB calls for the same test

      for (const result of results) {
        let email = (result.studentEmail || "").toString().trim();
        if (!email || email.toLowerCase() === "guest@test.com") {
          if (result.studentFields) {
            const emailKey = Object.keys(result.studentFields).find(k => k.toLowerCase() === 'email');
            if (emailKey) {
              email = (result.studentFields[emailKey] || "").toString().trim();
            }
          }
        }

        if (email && email.toLowerCase() !== "guest@test.com" && email.includes("@")) {
          let test = testCache[result.testId];
          if (!test && result.testId) {
            test = await Test.findById(result.testId);
            testCache[result.testId] = test;
          }

          const { percentileRank } = await getPercentileData(result.testId, result.score);
          result.percentileRank = percentileRank;

          const mailOptions = {
            from: (authUser || "").trim(),
            to: email,
            subject: `Comprehensive Exam Result: ${result.testName}`,
            html: generateEmailHTML(result, test)
          };
          
          try {
            await transporter.sendMail(mailOptions);
            sentCount++;
            
            // ✅ Save the success status to the database
            await Result.findByIdAndUpdate(result._id, {
              $set: { emailStatus: 'Sent', emailSentAt: new Date() }
            }, { strict: false });

          } catch (mailErr) {
            console.error(`Failed to send email to ${email}:`, mailErr.message);
            // ✅ Save the failure status to the database
            try {
              await Result.findByIdAndUpdate(result._id, {
                $set: { emailStatus: 'Failed', emailError: mailErr.message }
              }, { strict: false });
            } catch (dbErr) {
              console.error("DB update failed during bulk email error:", dbErr);
            }
          }
        }
      }
      console.log(`[BACKGROUND JOB]: Successfully sent ${sentCount} bulk result emails.`);
    })();
  } catch (err) {
    res.status(500).json({ msg: "Failed to send bulk emails ❌" });
  }
};

// ================= GET LEADERBOARD (PUBLISHED RESULTS) =================
exports.getLeaderboard = async (req, res) => {
  try {
    const { testId } = req.params;
    // Only fetch results that are published
    const results = await Result.find({ testId, isPublished: { $ne: false } })
      .select('studentName studentEmail score total percentage createdAt')
      .sort({ score: -1, percentage: -1 })
      .limit(10) // Strictly limit to TOP 10 performers
      .lean();

    res.json(results);
  } catch (err) {
    console.error("LEADERBOARD ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};
