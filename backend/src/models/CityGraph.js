import mongoose from "mongoose";

const cityGraphSchema = new mongoose.Schema(
  {
    city: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true
    },
    isGraphSaved: {
      type: Boolean,
      default: false
    },
    attractionsCount: {
      type: Number,
      default: 0
    },
    routesCount: {
      type: Number,
      default: 0
    },
    lastBuiltAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

export default mongoose.model("CityGraph", cityGraphSchema);
