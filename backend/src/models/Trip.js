import mongoose from "mongoose";

const tripSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    // Phase 0: Validated Trip Spec
    tripSpec: {
      origin: { type: String, required: true, trim: true },
      destination: { type: String, required: true, trim: true },
      departureDate: { type: String, required: true },
      returnDate: { type: String, default: null },
      passengers: { type: Number, default: 1, min: 1 },
      budgetInr: { type: Number, default: null },
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
        dietary: {
          type: String,
          default: "Any"
        }
      }
    },

    // Workflow Gate Status across the 8 phases
    workflowStatus: {
      type: String,
      enum: [
        "INPUT_VALIDATED",
        "TRANSPORT_SEARCHED",
        "TRANSPORT_SELECTED",
        "HOTELS_SEARCHED",
        "HOTEL_SELECTED",
        "PAYMENT_PENDING",
        "BOOKING_CONFIRMED",
        "HOTEL_GRAPH_LINKED",
        "ITINERARY_FINALIZED",
        "FAILED"
      ],
      default: "INPUT_VALIDATED"
    },

    // Phase 1 & 2: Transport Search & Selection
    flightResults: { type: Array, default: [] },
    trainResults: { type: Array, default: [] },
    selectedTransport: {
      type: { type: String, enum: ["FLIGHT", "TRAIN"] },
      providerReference: String,
      operatorName: String,
      identifier: String,
      departureTime: String,
      arrivalTime: String,
      duration: String,
      priceInr: Number,
      fareClass: String,
      isLiveFare: Boolean,
      fareBreakdown: { type: Array, default: [] },
      selectedAt: Date
    },

    // Phase 3 & 4: Hotel Discovery & Selection
    hotelResults: { type: Array, default: [] },
    landmarkSearch: {
      landmark: String,
      radiusKm: Number
    },
    selectedHotel: {
      hotelId: String,
      name: String,
      location: String,
      starRating: Number,
      pricePerNightInr: Number,
      totalPriceInr: Number,
      nights: Number,
      geoCode: {
        latitude: Number,
        longitude: Number
      },
      selectedAt: Date
    },

    // Phase 5: Booking & Payment State
    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "succeeded", "failed", "refunded"],
      default: "unpaid"
    },
    bookingStatus: {
      type: String,
      enum: ["unbooked", "pending", "booking_confirmed", "failed"],
      default: "unbooked"
    },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },

    // Phase 6, 7 & 8: Itinerary & Optimization Output
    itinerary: { type: Object, default: null },
    itineraryVersion: { type: Number, default: 1 }
  },
  { timestamps: true }
);

export default mongoose.model("Trip", tripSchema);
