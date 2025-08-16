// server.js
import express from "express";
import expressLayouts from "express-ejs-layouts";
import session from "express-session";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import webhookRoutes from "./routes/webhook.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(morgan('dev'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'pos-secret', resave: false, saveUninitialized: true }));

// mount routes
app.use(publicRoutes);
app.use(adminRoutes);
app.use(webhookRoutes);

// start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server running on http://localhost:${port}`));
