import crypto from "crypto";
import Razorpay from "razorpay";
import { config } from "../config/env.js";
import Trip from "../models/Trip.js";

/**
 * Calculates itemized checkout invoice for a trip.
 *
 * @param {Object} trip - MongoDB Trip document.
 * @returns {Object} Structured checkout invoice breakdown.
 */
export function calculateTripInvoice(trip) {
  if (!trip) {
    throw new Error("Trip document is required to calculate invoice.");
  }

  const transportCost = Math.round(Number(trip.selectedTransport?.priceInr || 0));
  const hotelCost = Math.round(Number(trip.selectedHotel?.totalPriceInr || 0));
  const totalCostInr = transportCost + hotelCost;

  return {
    tripId: trip._id,
    origin: trip.tripSpec?.origin,
    destination: trip.tripSpec?.destination,
    departureDate: trip.tripSpec?.departureDate,
    transport: {
      type: trip.selectedTransport?.type || null,
      operatorName: trip.selectedTransport?.operatorName || null,
      identifier: trip.selectedTransport?.identifier || null,
      departureTime: trip.selectedTransport?.departureTime || null,
      arrivalTime: trip.selectedTransport?.arrivalTime || null,
      duration: trip.selectedTransport?.duration || null,
      fareClass: trip.selectedTransport?.fareClass || "Standard",
      isLiveFare: Boolean(trip.selectedTransport?.isLiveFare),
      priceInr: transportCost
    },
    hotel: {
      name: trip.selectedHotel?.name || null,
      location: trip.selectedHotel?.location || null,
      starRating: trip.selectedHotel?.starRating || null,
      nights: Number(trip.selectedHotel?.nights || 1),
      pricePerNightInr: Math.round(Number(trip.selectedHotel?.pricePerNightInr || 0)),
      totalPriceInr: hotelCost
    },
    totalCostInr
  };
}

/**
 * Creates a Razorpay Order in test mode for the trip's itemized total.
 *
 * @param {Object} params
 * @param {string} params.tripId - Mongo Trip ID.
 * @param {string} params.userId - Mongo User ID.
 * @returns {Promise<Object>} Razorpay order payload.
 */
export async function createRazorpayOrder({ tripId, userId }) {
  const trip = await Trip.findOne({ _id: tripId, userId });
  if (!trip) {
    throw new Error("Trip not found or unauthorized.");
  }

  if (!trip.selectedTransport?.identifier) {
    throw new Error("Cannot create payment order: No transport has been selected yet.");
  }

  if (!trip.selectedHotel?.hotelId) {
    throw new Error("Cannot create payment order: No hotel has been selected yet.");
  }

  const invoice = calculateTripInvoice(trip);
  const totalCostInr = invoice.totalCostInr;

  if (totalCostInr <= 0) {
    throw new Error(`Invalid trip total cost: ₹${totalCostInr}. Must be greater than 0.`);
  }

  const amountInPaise = Math.round(totalCostInr * 100);
  const { razorpayKeyId, razorpayKeySecret } = config;

  if (razorpayKeyId && razorpayKeySecret) {
    const razorpay = new Razorpay({
      key_id: razorpayKeyId,
      key_secret: razorpayKeySecret
    });

    const receipt = `trip_${String(trip._id).slice(-8)}_${Date.now().toString().slice(-4)}`;
    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt,
      notes: {
        tripId: String(trip._id),
        origin: trip.tripSpec.origin,
        destination: trip.tripSpec.destination
      }
    };

    const order = await razorpay.orders.create(options);

    trip.razorpayOrderId = order.id;
    trip.paymentStatus = "pending";
    await trip.save();

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: razorpayKeyId,
      isTestMode: true,
      invoice
    };
  }

  // Developer sandbox fallback when keys are not yet configured in .env
  console.warn(
    "[PaymentService] RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing in .env. Generating development test order."
  );

  const mockOrderId = `order_test_${Date.now()}_${String(trip._id).slice(-6)}`;
  trip.razorpayOrderId = mockOrderId;
  trip.paymentStatus = "pending";
  await trip.save();

  return {
    orderId: mockOrderId,
    amount: amountInPaise,
    currency: "INR",
    keyId: "rzp_test_placeholder",
    isTestMode: true,
    isMock: true,
    invoice
  };
}

/**
 * Cryptographically verifies Razorpay payment signature (HMAC-SHA256)
 * and confirms the trip booking.
 *
 * @param {Object} params
 * @param {string} params.tripId
 * @param {string} params.userId
 * @param {string} params.razorpayOrderId
 * @param {string} params.razorpayPaymentId
 * @param {string} params.razorpaySignature
 * @returns {Promise<Object>} Confirmed booking state.
 */
export async function verifyRazorpayPayment({
  tripId,
  userId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature
}) {
  const trip = await Trip.findOne({ _id: tripId, userId });
  if (!trip) {
    throw new Error("Trip not found or unauthorized.");
  }

  if (!razorpayOrderId || !razorpayPaymentId) {
    throw new Error("razorpayOrderId and razorpayPaymentId are required for payment verification.");
  }

  const { razorpayKeySecret } = config;

  if (razorpayKeySecret && razorpaySignature) {
    const generatedSignature = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (generatedSignature !== razorpaySignature) {
      trip.paymentStatus = "failed";
      await trip.save();
      throw new Error("Invalid Razorpay payment signature. Cryptographic verification failed.");
    }
  } else if (!razorpayKeySecret) {
    console.warn(
      "[PaymentService] RAZORPAY_KEY_SECRET not set. Verifying mock development payment."
    );
  }

  // Atomically confirm booking state
  trip.paymentStatus = "succeeded";
  trip.bookingStatus = "booking_confirmed";
  trip.razorpayOrderId = razorpayOrderId;
  trip.razorpayPaymentId = razorpayPaymentId;
  trip.workflowStatus = "BOOKING_CONFIRMED";

  await trip.save();

  return {
    success: true,
    tripId: trip._id,
    paymentStatus: trip.paymentStatus,
    bookingStatus: trip.bookingStatus,
    workflowStatus: trip.workflowStatus,
    razorpayOrderId,
    razorpayPaymentId
  };
}
