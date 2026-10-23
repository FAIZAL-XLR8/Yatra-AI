import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { generateTokenAndSetCookie } from "../utils/generateToken.js";

// @desc    Register a new user
// @route   POST /api/auth/register
export async function register(req, res) {
  try {
    const { name, email, password, preferences } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Please provide name, email, and password" });
    }

    if (password.length < 6 || password.length > 20) {
      return res.status(400).json({ message: "Password must be between 6 and 20 characters" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "An account with this email already exists" });
    }

    // Hash the password with bcrypt
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user with default ₹50,000 wallet
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      preferences: preferences || {}
    });

    // Attach JWT in HTTP-only cookie
    generateTokenAndSetCookie(res, user._id);

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      walletBalance: user.walletBalance,
      preferences: user.preferences
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// @desc    Login user & get token cookie
// @route   POST /api/auth/login
export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Please provide email and password" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    generateTokenAndSetCookie(res, user._id);

    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      walletBalance: user.walletBalance,
      preferences: user.preferences
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// @desc    Logout user & clear cookie
// @route   POST /api/auth/logout
export function logout(req, res) {
  try {
    res.cookie("jwt", "", {
      httpOnly: true,
      maxAge: 0 // Expire immediately
    });
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
