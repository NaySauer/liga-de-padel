const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const initSqlJs = require("sql.js");

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 3000);
const DB_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DB_DIR, "liga-padel.sqlite");
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CambiarAdmin123!";

app.disable("x-powered-by");
app.use(express.json({ limit: "30kb" }));
app.use(session({
  name: "liga.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, "public")));

let db;

function saveDatabase() {
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function run(sql, params = []) {
  db.run(sql, params);
}

function rows(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const result = [];

  while (stmt.step()) {
    result.push(stmt.getAsObject());
  }

  stmt.free();
  return result;
}

function one(sql, params = []) {
  return rows(sql, params)[0] || null;
}

function cleanName(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 60)
    : "";
}

function normalizeName(value) {
  return cleanName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

// =====================================================
// BASE DE DATOS
// =====================================================

function initSchema() {
  run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  run(`CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team1_player1 TEXT NOT NULL,
    team1_player2 TEXT NOT NULL,
    team2_player1 TEXT,
    team2_player2 TEXT,
    match_date TEXT,
    court TEXT,
    status TEXT NOT NULL DEFAULT 'waiting',
    set1 TEXT DEFAULT '',
    set2 TEXT DEFAULT '',
    set3 TEXT DEFAULT '',
    winner INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`);

  run(`CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    end_date TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'preparation',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
  )`);

  run(`CREATE TABLE IF NOT EXISTS tournament_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tournament_id, name)
  )`);

  run(`CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cancelled_at TEXT,
    CHECK(player1_id <> player2_id)
  )`);

  run(`CREATE INDEX IF NOT EXISTS idx_registrations_tournament
    ON registrations(tournament_id, category_id, status)`);

  // NUEVA TABLA: DESAFÍOS DE CADA CATEGORÍA

  run(`CREATE TABLE IF NOT EXISTS tournament_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    creator_registration_id INTEGER NOT NULL,
    opponent_registration_id INTEGER,
    created_by_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    set1 TEXT DEFAULT '',
    set2 TEXT DEFAULT '',
    set3 TEXT DEFAULT '',
    winner_registration_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT
  )`);
    // Agregar datos de cancha, lugar, fecha y horario
  // sin borrar los desafíos que ya existen.

  const challengeColumns = rows(
    "PRAGMA table_info(tournament_challenges)"
  );

  const existingColumns = challengeColumns.map(col => col.name);

  if (!existingColumns.includes("court")) {
    run("ALTER TABLE tournament_challenges ADD COLUMN court TEXT DEFAULT ''");
  }

  if (!existingColumns.includes("place")) {
    run("ALTER TABLE tournament_challenges ADD COLUMN place TEXT DEFAULT ''");
  }

  if (!existingColumns.includes("match_date")) {
    run("ALTER TABLE tournament_challenges ADD COLUMN match_date TEXT DEFAULT ''");
  }

  if (!existingColumns.includes("match_time")) {
    run("ALTER TABLE tournament_challenges ADD COLUMN match_time TEXT DEFAULT ''");
  }

  run(`CREATE INDEX IF NOT EXISTS idx_challenges_tournament_category
    ON tournament_challenges(tournament_id, category_id, status)`);
}

// =====================================================
// ADMINISTRADOR
// =====================================================

function ensureAdmin() {
  const existing = one(
    "SELECT id FROM users WHERE normalized_name = 'admin'"
  );

  if (!existing) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);

    run(
      "INSERT INTO users (full_name, normalized_name, password_hash, role, status) VALUES (?, ?, ?, 'admin', 'approved')",
      ["Administrador", "admin", hash]
    );

    console.log("Usuario administrador creado: admin");

    if (!process.env.ADMIN_PASSWORD) {
      console.log(
        "Contraseña inicial de administrador: CambiarAdmin123! (cambiala antes de usar la app)"
      );
    }
  }
}

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    role: user.role,
    status: user.status
  };
}

// =====================================================
// SEGURIDAD Y PERMISOS
// =====================================================

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      error: "Iniciá sesión para continuar."
    });
  }

  const user = one(
    "SELECT id, full_name, role, status FROM users WHERE id = ?",
    [req.session.userId]
  );

  if (!user) {
    req.session.destroy(() => {});

    return res.status(401).json({
      error: "La sesión venció. Volvé a ingresar."
    });
  }

  req.user = user;
  next();
}

function requireApproved(req, res, next) {
  requireLogin(req, res, () => {
    if (req.user.role !== "admin" && req.user.status !== "approved") {
      return res.status(403).json({
        error: "Tu cuenta todavía está pendiente de aprobación por la organización.",
        status: req.user.status
      });
    }

    next();
  });
}

function requireAdmin(req, res, next) {
  requireLogin(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        error: "Esta función es exclusiva del administrador."
      });
    }

    next();
  });
}

// =====================================================
// AUTENTICACIÓN
// =====================================================

app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  const user = one(
    "SELECT id, full_name, role, status FROM users WHERE id = ?",
    [req.session.userId]
  );

  if (!user) {
    return res.json({ user: null });
  }

  res.json({ user: publicUser(user) });
});

app.post("/api/auth/register", async (req, res) => {
  const fullName = cleanName(req.body.fullName);
  const password = typeof req.body.password === "string"
    ? req.body.password
    : "";

  if (fullName.length < 5 || fullName.split(" ").length < 2) {
    return res.status(400).json({
      error: "Ingresá nombre y apellido."
    });
  }

  if (normalizeName(fullName) === "admin") {
    return res.status(400).json({
      error: "Ese nombre de usuario no está disponible."
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: "La contraseña debe tener al menos 8 caracteres."
    });
  }

  if (one(
    "SELECT id FROM users WHERE normalized_name = ?",
    [normalizeName(fullName)]
  )) {
    return res.status(409).json({
      error: "Ya existe una cuenta con ese nombre y apellido. Contactá a la organización si es tu cuenta."
    });
  }

  const hash = await bcrypt.hash(password, 12);

  run(
    "INSERT INTO users (full_name, normalized_name, password_hash, role, status) VALUES (?, ?, ?, 'player', 'pending')",
    [fullName, normalizeName(fullName), hash]
  );

  saveDatabase();

  res.status(201).json({
    message: "Registro recibido. Tu cuenta quedó pendiente de aprobación por el administrador."
  });
});

app.post("/api/auth/login", async (req, res) => {
  const username = typeof req.body.username === "string"
    ? req.body.username.trim()
    : "";

  const password = typeof req.body.password === "string"
    ? req.body.password
    : "";

  if (!username || !password) {
    return res.status(400).json({
      error: "Completá usuario y contraseña."
    });
  }

  const normalized = normalizeName(username);

  const user = one(
    "SELECT * FROM users WHERE normalized_name = ?",
    [normalized]
  );

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({
      error: "Usuario o contraseña incorrectos."
    });
  }

  req.session.userId = user.id;

  res.json({
    user: publicUser(user)
  });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({
        error: "No se pudo cerrar la sesión."
      });
    }

    res.clearCookie("liga.sid");
    res.json({ ok: true });
  });
});

// =====================================================
// ADMINISTRACIÓN DE JUGADORES
// =====================================================

app.get("/api/admin/users", requireAdmin, (req, res) => {
  res.json(rows(
    `SELECT id, full_name, status, created_at
     FROM users
     WHERE role = 'player'
     ORDER BY
       CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
       full_name COLLATE NOCASE`
  ));
});

app.patch("/api/admin/users/:id/status", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;

  if (!Number.isInteger(id) || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({
      error: "Solicitud inválida."
    });
  }

  const user = one(
    "SELECT id FROM users WHERE id = ? AND role = 'player'",
    [id]
  );

  if (!user) {
    return res.status(404).json({
      error: "No encontramos ese jugador."
    });
  }

  run(
    "UPDATE users SET status = ? WHERE id = ?",
    [status, id]
  );

  saveDatabase();

  res.json({ ok: true });
});

// ELIMINAR JUGADOR Y SUS DATOS RELACIONADOS

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      error: "ID de jugador inválido."
    });
  }

  const user = one(
    "SELECT id, full_name FROM users WHERE id = ? AND role = 'player'",
    [id]
  );

  if (!user) {
    return res.status(404).json({
      error: "No encontramos ese jugador."
    });
  }

  // Eliminar desafíos relacionados con sus inscripciones
  run(
    `DELETE FROM tournament_challenges
     WHERE created_by_user_id = ?
        OR creator_registration_id IN (
          SELECT id FROM registrations
          WHERE player1_id = ? OR player2_id = ?
        )
        OR opponent_registration_id IN (
          SELECT id FROM registrations
          WHERE player1_id = ? OR player2_id = ?
        )`,
    [id, id, id, id, id]
  );

  // Eliminar todas sus inscripciones en todos los torneos
  run(
    `DELETE FROM registrations
     WHERE player1_id = ? OR player2_id = ?`,
    [id, id]
  );

  // Eliminar la cuenta del jugador
  run(
    "DELETE FROM users WHERE id = ? AND role = 'player'",
    [id]
  );

  saveDatabase();

  res.json({
    ok: true,
    message: `Jugador ${user.full_name} eliminado correctamente.`
  });
});


// =====================================================
// TORNEOS
// =====================================================

app.get("/api/tournaments", requireApproved, (req, res) => {
  const tournaments = rows(
    "SELECT * FROM tournaments ORDER BY created_at DESC"
  );

  res.json(tournaments);
});

app.post("/api/admin/tournaments", requireAdmin, (req, res) => {
  const { name, description, start_date, end_date } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      error: "El nombre del torneo es obligatorio."
    });
  }

  run(
    `INSERT INTO tournaments (name, description, start_date, end_date, status)
     VALUES (?, ?, ?, ?, 'preparation')`,
    [
      name.trim(),
      description || "",
      start_date || "",
      end_date || ""
    ]
  );

  saveDatabase();

  res.json({ ok: true });
});

app.patch("/api/admin/tournaments/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, description, start_date, end_date, status } = req.body;

  const validStatuses = [
    "preparation",
    "open",
    "in_progress",
    "finished"
  ];

  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    !validStatuses.includes(status)
  ) {
    return res.status(400).json({
      error: "Datos inválidos."
    });
  }

  const tournament = one(
    "SELECT id FROM tournaments WHERE id = ?",
    [id]
  );

  if (!tournament) {
    return res.status(404).json({
      error: "No encontramos ese torneo."
    });
  }

  run(
    `UPDATE tournaments
     SET name = ?, description = ?, start_date = ?, end_date = ?,
         status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      name || "",
      description || "",
      start_date || "",
      end_date || "",
      status,
      id
    ]
  );

  saveDatabase();

  res.json({ ok: true });
});

app.delete("/api/admin/tournaments/:id", requireAdmin, (req, res) => {
  const tournamentId = Number(req.params.id);

  const tournament = one(
    "SELECT * FROM tournaments WHERE id = ?",
    [tournamentId]
  );

  if (!tournament) {
    return res.status(404).json({
      error: "El torneo no existe."
    });
  }

  run(
    "DELETE FROM tournament_challenges WHERE tournament_id = ?",
    [tournamentId]
  );

  run(
    "DELETE FROM registrations WHERE tournament_id = ?",
    [tournamentId]
  );

  run(
    "DELETE FROM tournament_categories WHERE tournament_id = ?",
    [tournamentId]
  );

  run(
    "DELETE FROM tournaments WHERE id = ?",
    [tournamentId]
  );

  saveDatabase();

  res.json({
    ok: true,
    message: "Torneo eliminado correctamente."
  });
});

// =====================================================
// CATEGORÍAS
// =====================================================

app.get("/api/tournaments/:id/categories", requireApproved, (req, res) => {
  const tournamentId = Number(req.params.id);

  const categories = rows(
    "SELECT * FROM tournament_categories WHERE tournament_id = ? ORDER BY name",
    [tournamentId]
  );

  res.json(categories);
});

app.post("/api/admin/tournaments/:id/categories", requireAdmin, (req, res) => {
  const tournamentId = Number(req.params.id);
  const name = String(req.body.name || "").trim();

  if (!name) {
    return res.status(400).json({
      error: "Ingresá el nombre de la categoría."
    });
  }

  const tournament = one(
    "SELECT id FROM tournaments WHERE id = ?",
    [tournamentId]
  );

  if (!tournament) {
    return res.status(404).json({
      error: "El torneo no existe."
    });
  }

  const existing = one(
    "SELECT id FROM tournament_categories WHERE tournament_id = ? AND name = ?",
    [tournamentId, name]
  );

  if (existing) {
    return res.status(400).json({
      error: "Esa categoría ya existe en este torneo."
    });
  }

  run(
    "INSERT INTO tournament_categories (tournament_id, name) VALUES (?, ?)",
    [tournamentId, name]
  );

  saveDatabase();

  res.json({
    ok: true,
    message: "Categoría creada correctamente."
  });
});

// =====================================================
// INSCRIPCIONES DE PAREJAS
// =====================================================

app.get("/api/tournaments/:id/players", requireApproved, (req, res) => {
  const tournamentId = Number(req.params.id);

  const tournament = one(
    "SELECT id FROM tournaments WHERE id = ?",
    [tournamentId]
  );

  if (!tournament) {
    return res.status(404).json({
      error: "El torneo no existe."
    });
  }

  const players = rows(
    `SELECT id, full_name
     FROM users
     WHERE role = 'player'
       AND status = 'approved'
       AND id <> ?
     ORDER BY full_name COLLATE NOCASE`,
    [req.user.id]
  );

  res.json(players);
});

app.get("/api/tournaments/:id/registrations/mine", requireApproved, (req, res) => {
  const tournamentId = Number(req.params.id);

  const registrations = rows(
    `SELECT r.id, r.tournament_id, r.category_id, r.player1_id, r.player2_id,
            r.status, r.created_at, c.name AS category_name,
            u1.full_name AS player1_name, u2.full_name AS player2_name
     FROM registrations r
     JOIN tournament_categories c ON c.id = r.category_id
     JOIN users u1 ON u1.id = r.player1_id
     JOIN users u2 ON u2.id = r.player2_id
     WHERE r.tournament_id = ?
       AND r.status = 'active'
       AND (r.player1_id = ? OR r.player2_id = ?)
     ORDER BY c.name`,
    [tournamentId, req.user.id, req.user.id]
  );

  res.json(registrations);
});

// Parejas inscriptas visibles para todos los jugadores

app.get("/api/tournaments/:id/registrations/list", requireApproved, (req, res) => {
  const tournamentId = Number(req.params.id);

  const registrations = rows(
    `SELECT r.id, c.name AS category_name,
            u1.full_name AS player1_name,
            u2.full_name AS player2_name
     FROM registrations r
     JOIN tournament_categories c ON c.id = r.category_id
     JOIN users u1 ON u1.id = r.player1_id
     JOIN users u2 ON u2.id = r.player2_id
     WHERE r.tournament_id = ?
       AND r.status = 'active'
     ORDER BY c.name, u1.full_name`,
    [tournamentId]
  );

  res.json(registrations);
});

app.post("/api/tournaments/:id/registrations", requireApproved, (req, res) => {
  if (req.user.role === "admin") {
    return res.status(403).json({
      error: "La inscripción debe realizarla un jugador."
    });
  }

  const tournamentId = Number(req.params.id);
  const categoryId = Number(req.body.categoryId);
  const partnerId = Number(req.body.partnerId);

  if (
    !Number.isInteger(tournamentId) || tournamentId <= 0 ||
    !Number.isInteger(categoryId) || categoryId <= 0 ||
    !Number.isInteger(partnerId) || partnerId <= 0
  ) {
    return res.status(400).json({
      error: "Seleccioná una categoría y un compañero."
    });
  }

  if (partnerId === req.user.id) {
    return res.status(400).json({
      error: "No podés inscribirte con vos mismo."
    });
  }

  const tournament = one(
    "SELECT id, status FROM tournaments WHERE id = ?",
    [tournamentId]
  );

  if (!tournament) {
    return res.status(404).json({
      error: "El torneo no existe."
    });
  }

  if (tournament.status !== "open") {
    return res.status(409).json({
      error: "Este torneo no tiene las inscripciones abiertas."
    });
  }

  const category = one(
    "SELECT id FROM tournament_categories WHERE id = ? AND tournament_id = ?",
    [categoryId, tournamentId]
  );

  if (!category) {
    return res.status(400).json({
      error: "La categoría no pertenece a este torneo."
    });
  }

  const partner = one(
    "SELECT id FROM users WHERE id = ? AND role = 'player' AND status = 'approved'",
    [partnerId]
  );

  if (!partner) {
    return res.status(400).json({
      error: "El compañero elegido no existe o no está aprobado."
    });
  }

  const alreadyRegistered = one(
    `SELECT id FROM registrations
     WHERE tournament_id = ?
       AND category_id = ?
       AND status = 'active'
       AND (
         player1_id IN (?, ?) OR player2_id IN (?, ?)
       )`,
    [
      tournamentId,
      categoryId,
      req.user.id,
      partnerId,
      req.user.id,
      partnerId
    ]
  );

  if (alreadyRegistered) {
    return res.status(409).json({
      error: "Vos o tu compañero ya están inscriptos en una pareja de esta categoría."
    });
  }

  run(
    `INSERT INTO registrations
      (tournament_id, category_id, player1_id, player2_id, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [tournamentId, categoryId, req.user.id, partnerId]
  );

  const registrationId = db.exec(
    "SELECT last_insert_rowid()"
  )[0].values[0][0];

  const registration = one(
    `SELECT r.id, r.tournament_id, r.category_id, r.status, r.created_at,
            c.name AS category_name,
            u1.full_name AS player1_name, u2.full_name AS player2_name
     FROM registrations r
     JOIN tournament_categories c ON c.id = r.category_id
     JOIN users u1 ON u1.id = r.player1_id
     JOIN users u2 ON u2.id = r.player2_id
     WHERE r.id = ?`,
    [registrationId]
  );

  saveDatabase();

  res.status(201).json({
    ok: true,
    message: "¡Pareja inscripta correctamente!",
    registration
  });
});

app.get("/api/admin/tournaments/:id/registrations", requireAdmin, (req, res) => {
  const tournamentId = Number(req.params.id);

  const tournament = one(
    "SELECT id FROM tournaments WHERE id = ?",
    [tournamentId]
  );

  if (!tournament) {
    return res.status(404).json({
      error: "El torneo no existe."
    });
  }

  const registrations = rows(
    `SELECT r.id, r.tournament_id, r.category_id, r.status, r.created_at,
            r.cancelled_at, c.name AS category_name,
            u1.full_name AS player1_name, u2.full_name AS player2_name
     FROM registrations r
     JOIN tournament_categories c ON c.id = r.category_id
     JOIN users u1 ON u1.id = r.player1_id
     JOIN users u2 ON u2.id = r.player2_id
     WHERE r.tournament_id = ?
     ORDER BY c.name, r.created_at`,
    [tournamentId]
  );

  res.json(registrations);
});

app.patch("/api/admin/registrations/:id/cancel", requireAdmin, (req, res) => {
  const registrationId = Number(req.params.id);

  if (!Number.isInteger(registrationId) || registrationId <= 0) {
    return res.status(400).json({
      error: "Inscripción inválida."
    });
  }

  const registration = one(
    "SELECT id, status FROM registrations WHERE id = ?",
    [registrationId]
  );

  if (!registration) {
    return res.status(404).json({
      error: "No encontramos esa inscripción."
    });
  }

  if (registration.status !== "active") {
    return res.status(409).json({
      error: "Esta pareja ya fue dada de baja."
    });
  }

  run(
    "UPDATE registrations SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?",
    [registrationId]
  );

  // Si se da de baja una pareja, sus desafíos abiertos o partidos en curso
  // también se cancelan.

  run(
    `UPDATE tournament_challenges
     SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
     WHERE status IN ('open', 'playing')
       AND (creator_registration_id = ? OR opponent_registration_id = ?)`,
    [registrationId, registrationId]
  );

  saveDatabase();

  res.json({
    ok: true,
    message: "La pareja fue dada de baja. Ambos jugadores pueden volver a inscribirse."
  });
});

// =====================================================
// ÁREA DE DESAFÍOS POR CATEGORÍA
// =====================================================

function getRegistration(registrationId) {
  return one(
    `SELECT r.id, r.tournament_id, r.category_id, r.player1_id, r.player2_id,
            r.status, u1.full_name AS player1_name, u2.full_name AS player2_name
     FROM registrations r
     JOIN users u1 ON u1.id = r.player1_id
     JOIN users u2 ON u2.id = r.player2_id
     WHERE r.id = ?`,
    [registrationId]
  );
}

function userBelongsToRegistration(userId, registrationId) {
  if (!registrationId) return false;

  return !!one(
    `SELECT id FROM registrations
     WHERE id = ?
       AND status = 'active'
       AND (player1_id = ? OR player2_id = ?)`,
    [registrationId, userId, userId]
  );
}

// -----------------------------------------------------
// OBTENER DESAFÍOS DE UNA CATEGORÍA
// -----------------------------------------------------

app.get("/api/tournaments/:id/challenges", requireApproved, (req, res) => {
  const tournamentId = Number(req.params.id);
  const categoryId = Number(req.query.categoryId);

  if (
    !Number.isInteger(tournamentId) || tournamentId <= 0 ||
    !Number.isInteger(categoryId) || categoryId <= 0
  ) {
    return res.status(400).json({
      error: "Torneo o categoría inválidos."
    });
  }

  const tournament = one(
    "SELECT id, status FROM tournaments WHERE id = ?",
    [tournamentId]
  );

  if (!tournament) {
    return res.status(404).json({
      error: "El torneo no existe."
    });
  }

  if (tournament.status !== "in_progress") {
    return res.status(409).json({
      error: "El área de desafíos estará disponible cuando el torneo esté en proceso."
    });
  }

  const category = one(
    "SELECT id, name FROM tournament_categories WHERE id = ? AND tournament_id = ?",
    [categoryId, tournamentId]
  );

  if (!category) {
    return res.status(404).json({
      error: "La categoría no pertenece a este torneo."
    });
  }

  const registrations = rows(
    `SELECT r.id, r.tournament_id, r.category_id, r.player1_id, r.player2_id,
            u1.full_name AS player1_name, u2.full_name AS player2_name
     FROM registrations r
     JOIN users u1 ON u1.id = r.player1_id
     JOIN users u2 ON u2.id = r.player2_id
     WHERE r.tournament_id = ?
       AND r.category_id = ?
       AND r.status = 'active'
     ORDER BY u1.full_name COLLATE NOCASE, u2.full_name COLLATE NOCASE`,
    [tournamentId, categoryId]
  );

  const myRegistration = req.user.role === "player"
    ? registrations.find(r =>
        r.player1_id === req.user.id ||
        r.player2_id === req.user.id
      ) || null
    : null;

  const challenges = rows(
    `SELECT ch.*,
            c1.player1_id AS creator_player1_id,
            c1.player2_id AS creator_player2_id,
            cu1.full_name AS creator_player1_name,
            cu2.full_name AS creator_player2_name,
            c2.player1_id AS opponent_player1_id,
            c2.player2_id AS opponent_player2_id,
            ou1.full_name AS opponent_player1_name,
            ou2.full_name AS opponent_player2_name
     FROM tournament_challenges ch
     JOIN registrations c1 ON c1.id = ch.creator_registration_id
     JOIN users cu1 ON cu1.id = c1.player1_id
     JOIN users cu2 ON cu2.id = c1.player2_id
     LEFT JOIN registrations c2 ON c2.id = ch.opponent_registration_id
     LEFT JOIN users ou1 ON ou1.id = c2.player1_id
     LEFT JOIN users ou2 ON ou2.id = c2.player2_id
     WHERE ch.tournament_id = ?
       AND ch.category_id = ?
       AND ch.status <> 'cancelled'
     ORDER BY
       CASE ch.status
         WHEN 'playing' THEN 0
         WHEN 'open' THEN 1
         ELSE 2
       END,
       ch.created_at DESC`,
    [tournamentId, categoryId]
  );

  let completedCount = 0;

  if (myRegistration) {
    completedCount = one(
      `SELECT COUNT(*) AS total
       FROM tournament_challenges
       WHERE status = 'completed'
         AND (
           creator_registration_id = ?
           OR opponent_registration_id = ?
         )`,
      [myRegistration.id, myRegistration.id]
    ).total;
  }

  res.json({
    tournament,
    category,
    registrations,
    myRegistration,
    completedCount,
    totalMatches: Math.max(
      0,
      (registrations.length * (registrations.length - 1)) / 2
    ),
    challenges
  });
});

// -----------------------------------------------------
// PUBLICAR UN DESAFÍO
// -----------------------------------------------------
app.post("/api/tournaments/:id/challenges", requireApproved, (req, res) => {
  if (req.user.role !== "player") {
    return res.status(403).json({
      error: "Solo los jugadores pueden publicar desafíos."
    });
  }

  const tournamentId = Number(req.params.id);
  const categoryId = Number(req.body.categoryId);

  // Datos del partido
  const court = cleanName(req.body.court);
  const place = cleanName(req.body.place);

  const matchDate = typeof req.body.matchDate === "string"
    ? req.body.matchDate.trim().slice(0, 30)
    : "";

  const matchTime = typeof req.body.matchTime === "string"
    ? req.body.matchTime.trim().slice(0, 20)
    : "";

  if (
    !Number.isInteger(tournamentId) || tournamentId <= 0 ||
    !Number.isInteger(categoryId) || categoryId <= 0
  ) {
    return res.status(400).json({
      error: "Seleccioná una categoría válida."
    });
  }

  if (!court || !place || !matchDate || !matchTime) {
    return res.status(400).json({
      error: "Completá cancha, lugar, día y horario del partido."
    });
  }

  const tournament = one(
    "SELECT id, status FROM tournaments WHERE id = ?",
    [tournamentId]
  );

  if (!tournament) {
    return res.status(404).json({
      error: "El torneo no existe."
    });
  }

  if (tournament.status !== "in_progress") {
    return res.status(409).json({
      error: "El torneo no está en proceso."
    });
  }

  const category = one(
    "SELECT id FROM tournament_categories WHERE id = ? AND tournament_id = ?",
    [categoryId, tournamentId]
  );

  if (!category) {
    return res.status(400).json({
      error: "La categoría no pertenece a este torneo."
    });
  }

  const registration = one(
    `SELECT id FROM registrations
     WHERE tournament_id = ?
       AND category_id = ?
       AND status = 'active'
       AND (player1_id = ? OR player2_id = ?)`,
    [tournamentId, categoryId, req.user.id, req.user.id]
  );

  if (!registration) {
    return res.status(403).json({
      error: "Tenés que tener una pareja inscripta en esta categoría para publicar un desafío."
    });
  }

  const busy = one(
    `SELECT id FROM tournament_challenges
     WHERE status IN ('open', 'playing')
       AND (
         creator_registration_id = ?
         OR opponent_registration_id = ?
       )`,
    [registration.id, registration.id]
  );

  if (busy) {
    return res.status(409).json({
      error: "Tu pareja ya tiene un desafío abierto o un partido en curso."
    });
  }

  run(
    `INSERT INTO tournament_challenges
      (
        tournament_id,
        category_id,
        creator_registration_id,
        created_by_user_id,
        court,
        place,
        match_date,
        match_time,
        status
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
    [
      tournamentId,
      categoryId,
      registration.id,
      req.user.id,
      court,
      place,
      matchDate,
      matchTime
    ]
  );

  const id = db.exec(
    "SELECT last_insert_rowid()"
  )[0].values[0][0];

  saveDatabase();

  res.status(201).json({
    ok: true,
    challenge: one(
      "SELECT * FROM tournament_challenges WHERE id = ?",
      [id]
    )
  });
});

// -----------------------------------------------------
// ANOTARSE A UN DESAFÍO PUBLICADO
// -----------------------------------------------------

app.post("/api/challenges/:id/join", requireApproved, (req, res) => {
  if (req.user.role !== "player") {
    return res.status(403).json({
      error: "Solo los jugadores pueden anotarse a un desafío."
    });
  }

  const challengeId = Number(req.params.id);

  const challenge = one(
    "SELECT * FROM tournament_challenges WHERE id = ?",
    [challengeId]
  );

  if (!challenge) {
    return res.status(404).json({
      error: "No encontramos ese desafío."
    });
  }

  if (challenge.status !== "open") {
    return res.status(409).json({
      error: "Este desafío ya no está disponible."
    });
  }

  const tournament = one(
    "SELECT status FROM tournaments WHERE id = ?",
    [challenge.tournament_id]
  );

  if (!tournament || tournament.status !== "in_progress") {
    return res.status(409).json({
      error: "El torneo no está en proceso."
    });
  }

  const opponentRegistrationId = Number(req.body.registrationId);
  const opponent = getRegistration(opponentRegistrationId);

  if (
    !opponent ||
    opponent.status !== "active" ||
    opponent.tournament_id !== challenge.tournament_id ||
    opponent.category_id !== challenge.category_id
  ) {
    return res.status(400).json({
      error: "La pareja seleccionada no pertenece a esta categoría."
    });
  }

  if (opponent.id === challenge.creator_registration_id) {
    return res.status(400).json({
      error: "No podés anotarte a tu propio desafío."
    });
  }

  if (!userBelongsToRegistration(req.user.id, opponent.id)) {
    return res.status(403).json({
      error: "Solo un integrante de esa pareja puede anotarla al desafío."
    });
  }

  const busy = one(
    `SELECT id FROM tournament_challenges
     WHERE status IN ('open', 'playing')
       AND (
         creator_registration_id = ?
         OR opponent_registration_id = ?
       )`,
    [opponent.id, opponent.id]
  );

  if (busy) {
    return res.status(409).json({
      error: "Tu pareja ya tiene un desafío abierto o un partido en curso."
    });
  }

  const previous = one(
    `SELECT id FROM tournament_challenges
     WHERE status = 'completed'
       AND (
         (creator_registration_id = ? AND opponent_registration_id = ?)
         OR
         (creator_registration_id = ? AND opponent_registration_id = ?)
       )`,
    [
      challenge.creator_registration_id,
      opponent.id,
      opponent.id,
      challenge.creator_registration_id
    ]
  );

  if (previous) {
    return res.status(409).json({
      error: "Estas parejas ya jugaron entre sí."
    });
  }

  run(
    `UPDATE tournament_challenges
     SET opponent_registration_id = ?,
         status = 'playing',
         started_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status = 'open'`,
    [opponent.id, challengeId]
  );

  saveDatabase();

  res.json({
    ok: true,
    challenge: one(
      "SELECT * FROM tournament_challenges WHERE id = ?",
      [challengeId]
    )
  });
});

// -----------------------------------------------------
// CANCELAR DESAFÍO
// SOLO PUEDE CANCELARLO QUIEN LO PUBLICÓ
// -----------------------------------------------------

app.patch("/api/challenges/:id/cancel", requireApproved, (req, res) => {
  if (req.user.role !== "player") {
    return res.status(403).json({
      error: "Solo el jugador que publicó el desafío puede cancelarlo."
    });
  }

  const challengeId = Number(req.params.id);

  const challenge = one(
    "SELECT * FROM tournament_challenges WHERE id = ?",
    [challengeId]
  );

  if (!challenge) {
    return res.status(404).json({
      error: "No encontramos ese desafío."
    });
  }

  if (challenge.created_by_user_id !== req.user.id) {
    return res.status(403).json({
      error: "Solo quien publicó este desafío puede cancelarlo."
    });
  }

  if (!["open", "playing"].includes(challenge.status)) {
    return res.status(409).json({
      error: "Este desafío ya no se puede cancelar."
    });
  }

  run(
    `UPDATE tournament_challenges
     SET status = 'cancelled',
         cancelled_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [challengeId]
  );

  saveDatabase();

  res.json({
    ok: true,
    message: "Desafío cancelado. Las dos parejas vuelven a tener pendiente este enfrentamiento."
  });
});

// -----------------------------------------------------
// GUARDAR RESULTADO DEL PARTIDO
// -----------------------------------------------------

app.put("/api/challenges/:id/score", requireApproved, (req, res) => {
  const challengeId = Number(req.params.id);

  const challenge = one(
    "SELECT * FROM tournament_challenges WHERE id = ?",
    [challengeId]
  );

  if (!challenge) {
    return res.status(404).json({
      error: "No encontramos ese partido."
    });
  }

  if (challenge.status !== "playing") {
    return res.status(409).json({
      error: "El partido no está en curso."
    });
  }

  const allowed =
    userBelongsToRegistration(
      req.user.id,
      challenge.creator_registration_id
    ) ||
    userBelongsToRegistration(
      req.user.id,
      challenge.opponent_registration_id
    );

  if (!allowed) {
    return res.status(403).json({
      error: "Solo los jugadores de las parejas participantes pueden cargar el resultado."
    });
  }

  const set1 = String(req.body.set1 || "").trim();
  const set2 = String(req.body.set2 || "").trim();
  const set3 = String(req.body.set3 || "").trim();

  if (!set1 || !set2 || (set3 && !validSet(set3))) {
    return res.status(400).json({
      error: "Completá correctamente los resultados de los sets."
    });
  }

  if (!validSet(set1) || !validSet(set2)) {
    return res.status(400).json({
      error: "Usá resultados válidos, por ejemplo 6-4, 3-6 o 7-5."
    });
  }

  run(
    `UPDATE tournament_challenges
     SET set1 = ?, set2 = ?, set3 = ?
     WHERE id = ?
       AND status = 'playing'`,
    [set1, set2, set3, challengeId]
  );

  saveDatabase();

  res.json({
    ok: true,
    challenge: one(
      "SELECT * FROM tournament_challenges WHERE id = ?",
      [challengeId]
    )
  });
});

// -----------------------------------------------------
// FINALIZAR PARTIDO
// -----------------------------------------------------

app.post("/api/challenges/:id/finish", requireApproved, (req, res) => {
  const challengeId = Number(req.params.id);

  const challenge = one(
    "SELECT * FROM tournament_challenges WHERE id = ?",
    [challengeId]
  );

  if (!challenge) {
    return res.status(404).json({
      error: "No encontramos ese partido."
    });
  }

  if (challenge.status !== "playing") {
    return res.status(409).json({
      error: "Este partido no está en curso."
    });
  }

  const allowed =
    userBelongsToRegistration(
      req.user.id,
      challenge.creator_registration_id
    ) ||
    userBelongsToRegistration(
      req.user.id,
      challenge.opponent_registration_id
    );

  if (!allowed) {
    return res.status(403).json({
      error: "Solo los jugadores de las parejas participantes pueden finalizar el partido."
    });
  }

  try {
    const winnerSide = calculateMatch(
      challenge.set1,
      challenge.set2,
      challenge.set3
    );

    const winnerRegistrationId = winnerSide === 1
      ? challenge.creator_registration_id
      : challenge.opponent_registration_id;

    run(
      `UPDATE tournament_challenges
       SET status = 'completed',
           winner_registration_id = ?,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status = 'playing'`,
      [winnerRegistrationId, challengeId]
    );

    saveDatabase();

    res.json({
      ok: true,
      challenge: one(
        "SELECT * FROM tournament_challenges WHERE id = ?",
        [challengeId]
      )
    });

  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});


// =====================================================
// RANKING POR TORNEO Y CATEGORÍA
// =====================================================

app.get(
  "/api/tournaments/:id/ranking",
  requireApproved,
  (req, res) => {

    const tournamentId = Number(req.params.id);
    const categoryId = Number(req.query.categoryId);

    if (
      !Number.isInteger(tournamentId) || tournamentId <= 0 ||
      !Number.isInteger(categoryId) || categoryId <= 0
    ) {
      return res.status(400).json({
        error: "Torneo o categoría inválidos."
      });
    }

    const category = one(
      `SELECT id, name, tournament_id
       FROM tournament_categories
       WHERE id = ? AND tournament_id = ?`,
      [categoryId, tournamentId]
    );

    if (!category) {
      return res.status(404).json({
        error: "No encontramos esa categoría."
      });
    }

    // Todas las parejas activas de la categoría
    const registrations = rows(
      `SELECT r.id,
              u1.full_name AS player1_name,
              u2.full_name AS player2_name
       FROM registrations r
       JOIN users u1 ON u1.id = r.player1_id
       JOIN users u2 ON u2.id = r.player2_id
       WHERE r.tournament_id = ?
         AND r.category_id = ?
         AND r.status = 'active'`,
      [tournamentId, categoryId]
    );

    const ranking = new Map();

    function ensurePair(registrationId, player1, player2) {

      if (!ranking.has(registrationId)) {
        ranking.set(registrationId, {
          registrationId,
          pair: `${player1} - ${player2}`,
          played: 0,
          wins: 0,
          losses: 0,
          points: 0
        });
      }

      return ranking.get(registrationId);
    }

    // Inicializar parejas activas aunque todavía no hayan jugado
    registrations.forEach(pair => {
      ensurePair(
        pair.id,
        pair.player1_name,
        pair.player2_name
      );
    });

    // Buscar partidos finalizados de esta categoría
    const completedMatches = rows(
      `SELECT
          ch.id,
          ch.creator_registration_id,
          ch.opponent_registration_id,
          ch.winner_registration_id,
          ch.set1,
          ch.set2,
          ch.set3,

          c1.player1_id AS c1_p1,
          c1.player2_id AS c1_p2,
          u1.full_name AS c1_name1,
          u2.full_name AS c1_name2,

          c2.player1_id AS c2_p1,
          c2.player2_id AS c2_p2,
          u3.full_name AS c2_name1,
          u4.full_name AS c2_name2

       FROM tournament_challenges ch

       JOIN registrations c1
         ON c1.id = ch.creator_registration_id

       JOIN users u1 ON u1.id = c1.player1_id
       JOIN users u2 ON u2.id = c1.player2_id

       JOIN registrations c2
         ON c2.id = ch.opponent_registration_id

       JOIN users u3 ON u3.id = c2.player1_id
       JOIN users u4 ON u4.id = c2.player2_id

       WHERE ch.tournament_id = ?
         AND ch.category_id = ?
         AND ch.status = 'completed'`,
      [tournamentId, categoryId]
    );

    // Calcular estadísticas y puntos
    completedMatches.forEach(match => {

      const pair1 = ensurePair(
        match.creator_registration_id,
        match.c1_name1,
        match.c1_name2
      );

      const pair2 = ensurePair(
        match.opponent_registration_id,
        match.c2_name1,
        match.c2_name2
      );

      pair1.played++;
      pair2.played++;

      const setsPlayed = [
        match.set1,
        match.set2,
        match.set3
      ].filter(Boolean).length;

      const winner = Number(match.winner_registration_id);

      if (winner === match.creator_registration_id) {

        pair1.wins++;
        pair2.losses++;

        pair1.points += setsPlayed === 2 ? 3 : 2;

        if (setsPlayed === 3) {
          pair2.points += 1;
        }

      } else if (winner === match.opponent_registration_id) {

        pair2.wins++;
        pair1.losses++;

        pair2.points += setsPlayed === 2 ? 3 : 2;

        if (setsPlayed === 3) {
          pair1.points += 1;
        }

      }

    });

    // Ordenar por puntos, luego victorias y finalmente nombre
    const table = [...ranking.values()].sort(
      (a, b) =>
        b.points - a.points ||
        b.wins - a.wins ||
        a.pair.localeCompare(b.pair, "es")
    );

    res.json({
      tournamentId,
      categoryId,
      categoryName: category.name,
      ranking: table
    });

  }
);


// =====================================================
// PARTIDOS Y RANKING ANTERIOR
// =====================================================

function getMatch(id) {
  return one(
    "SELECT * FROM matches WHERE id = ?",
    [id]
  );
}

function validSet(value) {
  if (!/^(?:[0-7])-(?:[0-7])$/.test(value)) {
    return false;
  }

  const [a, b] = value.split("-").map(Number);
  const high = Math.max(a, b);
  const low = Math.min(a, b);

  return a !== b &&
    (
      (high === 6 && low <= 4) ||
      (high === 7 && (low === 5 || low === 6))
    );
}

function calculateMatch(s1, s2, s3) {
  if (!validSet(s1) || !validSet(s2) || (s3 && !validSet(s3))) {
    throw new Error(
      "Usá resultados válidos, por ejemplo 6-4, 3-6 o 7-5."
    );
  }

  const played = [s1, s2, s3].filter(Boolean);
  const wins = [0, 0, 0];

  for (const s of played) {
    const [a, b] = s.split("-").map(Number);
    wins[a > b ? 1 : 2]++;
  }

  if (wins[1] === 1 && wins[2] === 1 && !s3) {
    throw new Error(
      "Si quedan 1 a 1 en sets, cargá el tercer set."
    );
  }

  if (wins[1] === wins[2]) {
    throw new Error(
      "El partido todavía no tiene un ganador."
    );
  }

  return wins[1] > wins[2] ? 1 : 2;
}

// -----------------------------------------------------
// PARTIDOS ANTERIORES
// -----------------------------------------------------

app.get("/api/matches", requireApproved, (req, res) => {
  res.json(
    rows("SELECT * FROM matches ORDER BY id DESC")
  );
});

app.post("/api/matches", requireApproved, (req, res) => {
  const p1 = cleanName(req.body.player1);
  const p2 = cleanName(req.body.player2);

  if (!p1 || !p2) {
    return res.status(400).json({
      error: "Completá los nombres de los dos jugadores."
    });
  }

  run(
    "INSERT INTO matches (team1_player1,team1_player2,match_date,court,status) VALUES (?,?,?,?,'waiting')",
    [
      p1,
      p2,
      cleanName(req.body.date),
      cleanName(req.body.court)
    ]
  );

  saveDatabase();

  const id = db.exec(
    "SELECT last_insert_rowid()"
  )[0].values[0][0];

  res.status(201).json(getMatch(id));
});

app.post("/api/matches/:id/challenge", requireApproved, (req, res) => {
  const id = Number(req.params.id);
  const m = getMatch(id);

  if (!m) {
    return res.status(404).json({
      error: "No encontramos ese partido."
    });
  }

  if (m.status !== "waiting") {
    return res.status(409).json({
      error: "Este desafío ya fue aceptado."
    });
  }

  const p1 = cleanName(req.body.player1);
  const p2 = cleanName(req.body.player2);

  if (!p1 || !p2) {
    return res.status(400).json({
      error: "Completá los nombres de los dos jugadores."
    });
  }

  run(
    "UPDATE matches SET team2_player1=?,team2_player2=?,status='playing' WHERE id=? AND status='waiting'",
    [p1, p2, id]
  );

  saveDatabase();

  res.json(getMatch(id));
});

app.put("/api/matches/:id/score", requireApproved, (req, res) => {
  const id = Number(req.params.id);
  const m = getMatch(id);

  if (!m) {
    return res.status(404).json({
      error: "No encontramos ese partido."
    });
  }

  if (m.status !== "playing") {
    return res.status(409).json({
      error: "Solo podés editar partidos en curso."
    });
  }

  const s1 = String(req.body.set1 || "").trim();
  const s2 = String(req.body.set2 || "").trim();
  const s3 = String(req.body.set3 || "").trim();

  for (const s of [s1, s2, s3]) {
    if (s && !validSet(s)) {
      return res.status(400).json({
        error: `Resultado inválido: ${s}. Ejemplo: 6-4.`
      });
    }
  }

  run(
    "UPDATE matches SET set1=?,set2=?,set3=? WHERE id=?",
    [s1, s2, s3, id]
  );

  saveDatabase();

  res.json(getMatch(id));
});

app.post("/api/matches/:id/finish", requireApproved, (req, res) => {
  const id = Number(req.params.id);
  const m = getMatch(id);

  if (!m) {
    return res.status(404).json({
      error: "No encontramos ese partido."
    });
  }

  if (m.status !== "playing") {
    return res.status(409).json({
      error: "Este partido no está en curso."
    });
  }

  try {
    const winner = calculateMatch(
      m.set1,
      m.set2,
      m.set3
    );

    run(
      "UPDATE matches SET status='completed',winner=?,completed_at=CURRENT_TIMESTAMP WHERE id=?",
      [winner, id]
    );

    saveDatabase();

    res.json(getMatch(id));

  } catch (e) {
    res.status(400).json({
      error: e.message
    });
  }
});

// -----------------------------------------------------
// RANKING ANTERIOR
// -----------------------------------------------------

app.get("/api/ranking", requireApproved, (req, res) => {
  const completed = rows(
    "SELECT * FROM matches WHERE status='completed'"
  );

  const table = new Map();

  function ensure(a, b) {
    const key = [a, b]
      .map(x => x.toLocaleLowerCase())
      .sort()
      .join("|");

    if (!table.has(key)) {
      table.set(key, {
        key,
        players: [a, b],
        played: 0,
        wins: 0,
        losses: 0,
        points: 0
      });
    }

    return table.get(key);
  }

  for (const m of completed) {
    const t1 = ensure(
      m.team1_player1,
      m.team1_player2
    );

    const t2 = ensure(
      m.team2_player1,
      m.team2_player2
    );

    t1.played++;
    t2.played++;

    const sets = [
      m.set1,
      m.set2,
      m.set3
    ].filter(Boolean);

    const w = Number(m.winner);
    const two = sets.length === 2;

    if (w === 1) {
      t1.wins++;
      t2.losses++;

      t1.points += two ? 3 : 2;

      if (!two) {
        t2.points++;
      }

    } else {
      t2.wins++;
      t1.losses++;

      t2.points += two ? 3 : 2;

      if (!two) {
        t1.points++;
      }
    }
  }

  res.json(
    [...table.values()].sort(
      (a, b) =>
        b.points - a.points ||
        b.wins - a.wins ||
        a.players.join(" ").localeCompare(b.players.join(" "))
    )
  );
});

// =====================================================
// ESTADO DEL SERVIDOR
// =====================================================

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// =====================================================
// INICIAR SERVIDOR
// =====================================================

initSqlJs().then(SQL => {
  fs.mkdirSync(DB_DIR, { recursive: true });

  db = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();

  initSchema();
  ensureAdmin();
  saveDatabase();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Liga de Pádel en http://localhost:${PORT}`);
  });

}).catch(err => {
  console.error("No se pudo iniciar SQLite:", err);
  process.exit(1);
});