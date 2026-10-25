import mongoose from "mongoose";

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null
    },
    type: {
      type: String,
      enum: ["CREDIT", "DEBIT", "ESCROW_LOCK", "REFUND"],
      required: true
    },
    amount: {
      type: Number,
      required: [true, "Transaction amount is required"],
      min: [1, "Amount must be at least ₹1"]
    },
    balanceBefore: {
      type: Number,
      required: true
    },
    balanceAfter: {
      type: Number,
      required: true
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true
    },
    razorpayPaymentId: {
      type: String,
      default: null // Stored when user tops up their wallet via Razorpay
    }
  },
  { timestamps: true }
);

export default mongoose.model("WalletTransaction", walletTransactionSchema);
