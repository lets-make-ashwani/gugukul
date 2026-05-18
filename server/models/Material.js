const mongoose = require("mongoose");

const materialSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    fileUrl: { type: String, required: true },
    type: { 
      type: String, 
      enum: ["video", "document", "result", "image"], 
      required: true 
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Material", materialSchema);