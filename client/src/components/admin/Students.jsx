import React, { useEffect, useState } from "react";
import API from "../../services/api";
import "./Students.css";

const Students = () => {

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  // ================= DELETE STUDENT =================
  const deleteStudent = async (id) => {

    if (!window.confirm("Delete this student? ❌")) return;

    try {

      await API.delete(`/auth/students/${id}`);

      alert("Deleted successfully ✅");

      // ✅ remove from UI instantly
      setStudents(prev => prev.filter(s => s._id !== id));

    } catch (err) {

      console.error(err);
      alert("Delete failed ❌");

    }
  };

  // ================= DELETE ALL STUDENTS =================
  const deleteAllStudents = async () => {
    if (!window.confirm("⚠️ Are you absolutely sure you want to delete ALL students and their results? This action CANNOT be undone! ❌")) return;
    
    try {
      setLoading(true);
      // Execute all delete requests concurrently safely processing the loop
      await Promise.all(students.map(s => API.delete(`/auth/students/${s._id}`)));
      alert("All students and their results deleted successfully ✅");
      setStudents([]);
    } catch (err) {
      console.error(err);
      alert("Failed to delete some or all students ❌");
    } finally {
      setLoading(false);
    }
  };

  // ================= EXPORT HANDLER =================
  const handleExport = async (type) => {
    try {
      const btn = document.getElementById(`export-${type}-btn`);
      const originalText = btn ? btn.innerText : "";
      if (btn) btn.innerText = "⏳ Processing...";

      const response = await API.get(`/auth/students?export=${type}`, {
        responseType: 'blob', // Secure blob download
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `students_list.${type === 'excel' ? 'xlsx' : 'pdf'}`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);

      if (btn) btn.innerText = originalText;
    } catch (err) {
      console.error("Export failed", err);
      alert("Export failed! Ensure the server is online. ❌");
      const btn = document.getElementById(`export-${type}-btn`);
      if (btn) btn.innerText = type === 'pdf' ? "📄 Download PDF" : "📊 Download Excel";
    }
  };

  // ================= FETCH =================
  useEffect(() => {
    const fetchStudents = async () => {
      try {
        const res = await API.get("/auth/students");
        setStudents(res.data || []);
      } catch (err) {
        console.error("Students fetch error:", err);
        setStudents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchStudents();
  }, []);

  // ================= SCORE COLOR =================
  const getClass = (avg) => {
    if (avg >= 70) return "score-high";
    if (avg >= 40) return "score-mid";
    return "score-low";
  };

  return (
    <div className="students-page">

      {/* HEADER */}
      <div className="page-header">
        <h2>Registered Students</h2>
        <p>Track performance and activity</p>
      </div>

      {/* CARD */}
      <div className="students-card">

        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
          <h3>All Students</h3>
          
          <div className="export-buttons" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button 
              id="export-pdf-btn" 
              onClick={() => handleExport('pdf')}
              style={{ background: "#f43f5e", color: "white", padding: "8px 16px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "bold", fontSize: "14px" }}
            >
              📄 Download PDF
            </button>
            <button 
              id="export-excel-btn" 
              onClick={() => handleExport('excel')}
              style={{ background: "#10b981", color: "white", padding: "8px 16px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "bold", fontSize: "14px" }}
            >
              📊 Download Excel
            </button>
            <button 
              onClick={deleteAllStudents}
              style={{ background: "#dc2626", color: "white", padding: "8px 16px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "bold", fontSize: "14px" }}
            >
              🗑 Delete All Students
            </button>
          </div>
        </div>

        {/* LOADING */}
        {loading ? (
          <div className="empty-state">
            <h3>Loading students...</h3>
          </div>
        ) : students.length === 0 ? (

          <div className="empty-state">
            <div className="icon">👥</div>
            <h3>No students registered</h3>
            <p>Students will appear here after registration</p>
          </div>

        ) : (

          <div className="table-wrapper">

            <table>

              <thead>
                <tr>
                  <th>Student</th>
                  <th>Email</th>
                  <th>Tests</th>
                  <th>Average Score</th>
                  <th>Action</th> {/* ✅ NEW */}
                </tr>
              </thead>

              <tbody>
                {students.map((s, i) => (
                  <tr key={s._id || i}>

                    <td>
                      <div className="student-cell">
                        <div className="avatar">
                          {s.name?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <strong>{s.name}</strong>
                        </div>
                      </div>
                    </td>

                    <td>{s.email}</td>

                    <td className="tests-count">
                      {s.tests || 0}
                    </td>

                    <td>
                      <span className={`pill ${getClass(s.avg || 0)}`}>
                        {s.avg || 0}%
                      </span>
                    </td>

                    {/* ✅ DELETE BUTTON */}
                    <td>
                      <button
                        className="btn-delete"
                        onClick={() => deleteStudent(s._id)}
                      >
                        Delete
                      </button>
                    </td>

                  </tr>
                ))}
              </tbody>

            </table>

          </div>

        )}

      </div>

    </div>
  );
};

export default Students;