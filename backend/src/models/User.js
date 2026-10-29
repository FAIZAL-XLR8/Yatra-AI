import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"]
    },
    preferences: {
      budgetTier: {
        type: String,
        enum: ["budget", "mid-range", "luxury"],
        default: "mid-range"
      },
      travelStyle: {
        type: String,
        enum: ["solo", "couple", "family", "friends"],
        default: "solo"
      },
      flightClass: {
        type: String,
        enum: ["economy", "business", "first"],
        default: "economy"
      },
      dietary: {
        type: String,
        default: "Any"
      }
    }
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
