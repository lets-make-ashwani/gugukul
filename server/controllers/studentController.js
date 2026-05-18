const User = require("../models/User");
const Result = require("../models/Result");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

// ================= GET ALL STUDENTS (ADMIN) =================
exports.getAllStudents = async (req, res) => {
  try {
    // ✅ Secure bypass to handle Excel and PDF exports through the existing GET route
    if (req.query.export === 'pdf') {
      return exports.exportStudentsPDF(req, res);
    }
    if (req.query.export === 'excel') {
      return exports.exportStudentsExcel(req, res);
    }

    // ✅ OPTIMIZED: Use MongoDB Aggregation to calculate stats efficiently in the database
    const studentsWithStats = await User.aggregate([
      // 1. Filter for users who are students
      { $match: { role: "student" } },
      // 2. Join with the results collection
      {
        $lookup: {
          from: "results", // the name of the results collection in MongoDB
          localField: "email",
          foreignField: "studentEmail",
          as: "studentResults"
        }
      },
      // 3. Add the calculated fields for tests taken and average score
      {
        $addFields: {
          tests: { $size: "$studentResults" },
          avg: {
            $cond: {
              if: { $gt: [{ $size: "$studentResults" }, 0] },
              then: { $round: [{ $avg: "$studentResults.percentage" }, 0] },
              else: 0
            }
          }
        }
      },
      // 4. Remove the large studentResults array and the password for security
      {
        $project: {
          studentResults: 0,
          password: 0
        }
      },
      // 5. Sort by registration date
      { $sort: { createdAt: -1 } }
    ]);

    res.json(studentsWithStats);
  } catch (err) {
    console.error("GET STUDENTS ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};

// ================= EXPORT STUDENTS PDF =================
exports.exportStudentsPDF = async (req, res) => {
  try {
    // ✅ OPTIMIZED: Use the same fast aggregation pipeline for exports
    const studentsWithStats = await User.aggregate([
      { $match: { role: "student" } },
      {
        $lookup: {
          from: "results",
          localField: "email",
          foreignField: "studentEmail",
          as: "studentResults"
        }
      },
      {
        $addFields: {
          tests: { $size: "$studentResults" },
          avg: {
            $cond: {
              if: { $gt: [{ $size: "$studentResults" }, 0] },
              then: { $round: [{ $avg: "$studentResults.percentage" }, 0] },
              else: 0
            }
          }
        }
      },
      { $project: { studentResults: 0, password: 0 } },
      { $sort: { createdAt: -1 } }
    ]);

    const doc = new PDFDocument({ margin: 30 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="students_list.pdf"');
    doc.pipe(res);

    doc.fontSize(20).text("Registered Students Report", { align: "center" });
    doc.moveDown();

    studentsWithStats.forEach((student, i) => {
      doc.fontSize(14).text(`${i + 1}. ${student.name}`);
      doc.fontSize(12).text(`Email: ${student.email}`);
      doc.text(`Tests Taken: ${student.tests}`);
      doc.text(`Average Score: ${student.avg}%`);
      doc.text(`Registered: ${new Date(student.createdAt).toLocaleDateString()}`);
      doc.moveDown();
    });

    doc.end();
  } catch (err) {
    console.error("PDF EXPORT ERROR:", err);
    res.status(500).json({ msg: "PDF export failed ❌" });
  }
};

// ================= EXPORT STUDENTS EXCEL =================
exports.exportStudentsExcel = async (req, res) => {
  try {
    // ✅ OPTIMIZED: Use the same fast aggregation pipeline for exports
    const studentsWithStats = await User.aggregate([
      { $match: { role: "student" } },
      {
        $lookup: {
          from: "results",
          localField: "email",
          foreignField: "studentEmail",
          as: "studentResults"
        }
      },
      {
        $addFields: {
          tests: { $size: "$studentResults" },
          avg: {
            $cond: {
              if: { $gt: [{ $size: "$studentResults" }, 0] },
              then: { $round: [{ $avg: "$studentResults.percentage" }, 0] },
              else: 0
            }
          }
        }
      },
      { $project: { studentResults: 0, password: 0 } },
      { $sort: { createdAt: -1 } }
    ]);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Students");

    worksheet.columns = [
      { header: "Name", key: "name", width: 25 },
      { header: "Email", key: "email", width: 30 },
      { header: "Tests Taken", key: "tests", width: 15 },
      { header: "Average Score", key: "avg", width: 15 },
      { header: "Registered Date", key: "date", width: 20 }
    ];

    // Make the header bold
    worksheet.getRow(1).font = { bold: true };

    studentsWithStats.forEach(student => {
      worksheet.addRow({
        name: student.name,
        email: student.email,
        tests: student.tests,
        avg: `${student.avg}%`,
        date: new Date(student.createdAt).toLocaleDateString()
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="students_list.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXCEL EXPORT ERROR:", err);
    res.status(500).json({ msg: "Excel export failed ❌" });
  }
};

// ================= GET SINGLE STUDENT =================
exports.getStudentById = async (req, res) => {
  try {
    const student = await User.findById(req.params.id).select("-password");

    if (!student) {
      return res.status(404).json({ msg: "Student not found ❌" });
    }

    res.json(student);
  } catch (err) {
    console.error("GET STUDENT ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};

// ================= GET MY PROFILE =================
exports.getMyProfile = async (req, res) => {
  try {
    const student = await User.findById(req.user.id).select("-password");

    res.json(student);
  } catch (err) {
    console.error("PROFILE ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};

// ================= UPDATE PROFILE =================
exports.updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;

    const student = await User.findById(req.user.id);

    if (!student) {
      return res.status(404).json({ msg: "Student not found ❌" });
    }

    student.name = name || student.name;
    student.email = email || student.email;

    await student.save();

    res.json({
      msg: "Profile updated ✅",
      student,
    });
  } catch (err) {
    console.error("UPDATE PROFILE ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};

// ================= DELETE STUDENT (ADMIN) =================
exports.deleteStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id);

    if (!student) {
      return res.status(404).json({ msg: "Student not found ❌" });
    }

    // 🔥 ALSO DELETE ALL RESULTS OF THAT STUDENT
    await Result.deleteMany({
      studentEmail: student.email
    });

    await student.deleteOne();

    res.json({
      msg: "Student & related results deleted ✅"
    });

  } catch (err) {
    console.error("DELETE STUDENT ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};

// ================= STUDENT DASHBOARD =================
exports.getStudentDashboard = async (req, res) => {
  try {
    const results = await Result.find({
      studentEmail: req.user.email,
      isPublished: { $ne: false }
    });

    const totalTests = results.length;

    const avgScore =
      totalTests > 0
        ? Math.round(
            results.reduce((acc, r) => acc + r.percentage, 0) / totalTests
          )
        : 0;

    res.json({
      totalTests,
      avgScore,
      results,
    });

  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    res.status(500).json({ msg: "Server Error ❌" });
  }
};