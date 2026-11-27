const $ = id => document.getElementById(id);

let toastTimer;
let currentUser = null;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3400);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Ocurrió un error.");
  }

  return data;
}
function getTurnstileToken(type) {
  return type === "login"
    ? window.loginTurnstileToken
    : window.registerTurnstileToken;
}

function resetTurnstile(type) {
  if (typeof turnstile === "undefined") return;

  const widgetId = type === "login"
    ? window.loginTurnstileId
    : window.registerTurnstileId;

  if (widgetId !== null) {
    turnstile.reset(widgetId);
  }

  if (type === "login") {
    window.loginTurnstileToken = "";
  } else {
    window.registerTurnstileToken = "";
  }
}
function showAuth(mode = "login") {
  $("authView").classList.remove("hidden");
  $("pendingView").classList.add("hidden");
  $("appView").classList.add("hidden");

  $("loginForm").classList.toggle("hidden", mode !== "login");
  $("registerForm").classList.toggle("hidden", mode !== "register");

  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
}

function showPending() {
  $("authView").classList.add("hidden");
  $("pendingView").classList.remove("hidden");
  $("appView").classList.add("hidden");
}

function showApp(user) {
  currentUser = user;
  $("authView").classList.add("hidden");
  $("pendingView").classList.add("hidden");
  $("appView").classList.remove("hidden");

  $("welcomeName").textContent = "Hola, " + user.fullName;

  const admin = user.role === "admin";

  $("roleLabel").textContent = admin ? "ADMINISTRADOR" : "JUGADOR";

  $("welcomeText").textContent = admin
    ? "Panel de organización y control de jugadores."
    : "Tu cuenta está aprobada. Bienvenido/a a la liga.";

  $("adminPanel").classList.toggle("hidden", !admin);
  $("playerPanel").classList.toggle("hidden", admin);

  if (admin) loadUsers();

  loadTournaments();
}

async function checkSession() {
  try {
    const result = await api("/api/auth/me");

    if (!result.user) return showAuth();

    const u = result.user;

    if (u.role !== "admin" && u.status !== "approved") {
      return showPending();
    }

    showApp(u);
  } catch (e) {
    showAuth();
  }
}

$("loginTab").onclick = () => showAuth("login");
$("registerTab").onclick = () => showAuth("register");

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const captchaToken = getTurnstileToken("login");

  if (!captchaToken) {
    toast("Completá la verificación de seguridad.");
    return;
  }

  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("loginUser").value,
        password: $("loginPassword").value,
        turnstileToken: captchaToken
      })
    });

    if (result.user.role !== "admin" && result.user.status !== "approved") {
      showPending();
      return;
    }

    showApp(result.user);
    toast("¡Bienvenido/a!");

  } catch (err) {
    resetTurnstile("login");
    toast(err.message);
  }
});

$("registerForm").addEventListener("submit", async e => {
  e.preventDefault();

  const p = $("registerPassword").value;
  const p2 = $("registerPassword2").value;

  if (p !== p2) {
    toast("Las contraseñas no coinciden.");
    return;
  }

  const captchaToken = getTurnstileToken("register");

  if (!captchaToken) {
    toast("Completá la verificación de seguridad.");
    return;
  }

  try {
    const result = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: $("registerName").value,
        password: p,
        turnstileToken: captchaToken
      })
    });

    $("registerForm").reset();
    resetTurnstile("register");
    showAuth("login");
    toast(result.message);

  } catch (err) {
    resetTurnstile("register");
    toast(err.message);
  }
});

async function logout() {
  try {
    await api("/api/auth/logout", {
      method: "POST",
      body: "{}"
    });
  } catch (e) {}

  showAuth();
  $("loginPassword").value = "";
}

$("logoutButton").onclick = logout;
$("pendingLogout").onclick = logout;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

// JUGADORES

async function loadUsers() {
  try {
    const users = await api("/api/admin/users");

    $("pendingCount").textContent =
      users.filter(u => u.status === "pending").length;

    $("approvedCount").textContent =
      users.filter(u => u.status === "approved").length;

    $("rejectedCount").textContent =
      users.filter(u => u.status === "rejected").length;

    $("usersList").innerHTML = users.length
      ? users.map(u => {
          const initials = u.full_name
            .split(" ")
            .slice(0, 2)
            .map(x => x[0])
            .join("")
            .toUpperCase();

          const state = u.status === "pending"
            ? "Pendiente"
            : u.status === "approved"
              ? "Aprobado"
              : "Rechazado";

          const actions = u.status === "pending"
            ? `<button class="approve" data-id="${u.id}" data-status="approved">APROBAR</button>
               <button class="reject" data-id="${u.id}" data-status="rejected">RECHAZAR</button>`
            : `<span class="state ${u.status}">${state}</span>`;

          return `
            <div class="user-card">
              <div class="avatar">${esc(initials)}</div>

              <div class="user-info">
                <div class="user-name">${esc(u.full_name)}</div>
                <div class="user-meta">Registro: ${esc(u.created_at)}</div>
              </div>

              <div class="user-actions">
                ${actions}
                <button
                  class="reject"
                  type="button"
                  data-delete-user="${u.id}"
                  style="margin-top:5px;"
                >
                  ELIMINAR
                </button>
              </div>
            </div>
          `;
        }).join("")
      : `<div class="notice-inline">Todavía no hay jugadores registrados.</div>`;

  } catch (e) {
    toast(e.message);
  }
}

// ACCIONES DE JUGADORES
$("usersList").addEventListener("click", async e => {

  const deleteBtn = e.target.closest("[data-delete-user]");

  if (deleteBtn) {
    const id = deleteBtn.dataset.deleteUser;

    if (!confirm(
      "¿Eliminar este jugador? Se borrarán su cuenta, inscripciones y desafíos. Esta acción no se puede deshacer."
    )) return;

    try {
      const result = await api(`/api/admin/users/${id}`, {
        method: "DELETE"
      });

      toast(result.message || "Jugador eliminado.");
      await loadUsers();
      await loadTournaments();

    } catch (err) {
      toast(err.message);
    }

    return;
  }

  const btn = e.target.closest("button[data-status]");
  if (!btn) return;

  try {
    await api(`/api/admin/users/${btn.dataset.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: btn.dataset.status })
    });

    toast(btn.dataset.status === "approved"
      ? "Jugador aprobado."
      : "Solicitud rechazada.");

    await loadUsers();

  } catch (err) {
    toast(err.message);
  }
});


// TORNEOS

const tournamentStatuses = {
  preparation: "En preparación",
  open: "Inscripciones abiertas",
  in_progress: "En curso",
  finished: "Finalizado"
};

// CATEGORÍAS

async function loadCategories(tournamentId) {
  try {
    const categories = await api(
      `/api/tournaments/${tournamentId}/categories`
    );

    const container = $(`categories-${tournamentId}`);

    if (!container) return;

    container.innerHTML = categories.length
      ? categories.map(category => `
          <div class="notice-inline">
            ${esc(category.name)}
          </div>
        `).join("")
      : `<div class="notice-inline">Todavía no hay categorías.</div>`;

  } catch (e) {
    toast(e.message);
  }
}

// CARGAR TORNEOS

async function loadTournaments() {
  try {
    const tournaments = await api("/api/tournaments");
    renderTournaments(tournaments);
  } catch (e) {
    toast(e.message);
  }
}

// MOSTRAR TORNEOS
function renderTournaments(tournaments) {
  const admin = $("adminTournamentsList");
  const players = $("playerTournaments");

  if (admin && currentUser && currentUser.role === "admin") {
    admin.innerHTML = tournaments.length
      ? tournaments.map(t => `
        <div class="user-card tournament-admin-card">

          <form class="tournament-edit-form" data-id="${t.id}">

            <h3>${esc(t.name)}</h3>
            <button
             class="button primary full"
              type="button"
             data-open-ranking="${t.id}">
            VER RANKING
            </button>

            <label class="form-label">Nombre</label>
            <input
              class="field"
              name="name"
              value="${esc(t.name)}"
              required
            >

            <label class="form-label">Descripción</label>
            <textarea class="field" name="description">${esc(t.description)}</textarea>

            <label class="form-label">Fecha de inicio</label>
            <input
              class="field"
              type="date"
              name="start_date"
              value="${esc(t.start_date)}"
            >

            <label class="form-label">Fecha de finalización</label>
            <input
              class="field"
              type="date"
              name="end_date"
              value="${esc(t.end_date)}"
            >

            <div class="tournament-categories">

              <h4>Categorías del torneo</h4>

              <div class="category-form" data-tournament-id="${t.id}">

                <input
                  class="field"
                  name="category"
                  placeholder="Ej. Caballeros 7ma"
                >

                <button
                  class="button primary full"
                  type="button"
                  data-add-category
                >
                  AGREGAR CATEGORÍA
                </button>

              </div>

              <div id="categories-${t.id}">
                Cargando categorías...
              </div>

              <h4>Parejas inscriptas</h4>
              <div id="registrations-${t.id}" class="registrations-list">
                Cargando parejas...
              </div>

            </div>

            <label class="form-label">Etapa del torneo</label>

            <select class="field" name="status">
              <option value="preparation" ${t.status === "preparation" ? "selected" : ""}>En preparación</option>
              <option value="open" ${t.status === "open" ? "selected" : ""}>Inscripciones abiertas</option>
              <option value="in_progress" ${t.status === "in_progress" ? "selected" : ""}>En curso</option>
              <option value="finished" ${t.status === "finished" ? "selected" : ""}>Finalizado</option>
            </select>

            <button class="button primary full" type="submit">
              GUARDAR CAMBIOS
            </button>

            <button
              class="button full"
              type="button"
              style="background:#dc3545; margin-top:8px;"
              data-delete-tournament="${t.id}"
            >
              ELIMINAR TORNEO
            </button>

          </form>

        </div>
      `).join("")
      : `<div class="notice-inline">Todavía no creaste ningún torneo.</div>`;

    tournaments.forEach(t => {
      loadCategories(t.id);
      loadAdminRegistrations(t.id);
    });
  }

  if (players && currentUser && currentUser.role !== "admin") {
    players.innerHTML = tournaments.length
      ? tournaments.map(t => `
        <div class="tournament-card">

          <div class="tournament-symbol">🎾</div>

          <div class="eyebrow">TORNEO</div>

          <h2>${esc(t.name)}</h2>

          <p>${esc(t.description || "")}</p>

          <span class="status-pill">
            ${tournamentStatuses[t.status] || "Sin estado"}
          </span>
          <button
          class="button primary full"
         type="button"
         data-open-ranking="${t.id}">
         VER RANKING
         </button>

          <details class="public-pairs">
            <summary class="button light small">VER PAREJAS INSCRIPTAS</summary>
            <div id="public-pairs-${t.id}" class="public-pairs-content">
              Cargando parejas...
            </div>
          </details>

          ${
            t.status === "preparation"
              ? "<p>Próximamente podrás inscribirte.</p>"
              : t.status === "open"
                ? `
                  <p>Las inscripciones están abiertas.</p>

                  <div class="player-registration" data-tournament-id="${t.id}">
                    <label class="form-label">Categoría</label>

                    <select class="field" data-category>
                      <option value="">Cargando categorías...</option>
                    </select>

                    <label class="form-label">Elegí tu pareja</label>

                    <select class="field" data-partner>
                      <option value="">Cargando jugadores...</option>
                    </select>

                    <button class="button primary full" type="button" data-register-pair>
                      INSCRIBIR PAREJA
                    </button>

                    <div class="my-registration-list" data-my-registrations>
                      Cargando tus inscripciones...
                    </div>
                  </div>
                `
                : t.status === "in_progress"
                  ? `
                    <p>Este torneo se encuentra en curso. Las inscripciones están cerradas.</p>
                    <button class="button primary full" type="button" data-open-challenges="${t.id}">
                      ÁREA DE DESAFÍOS
                    </button>
                    <section id="challenge-area-${t.id}" class="challenge-area hidden">
                      <button class="button light small" type="button" data-close-challenges="${t.id}">
                        ← VOLVER AL TORNEO
                      </button>
                      <h3>Área de desafíos</h3>
                      <label class="form-label">Categoría</label>
                      <select class="field" data-challenge-category>
                        <option value="">Cargando categorías...</option>
                      </select>
                      <div data-challenge-content class="challenge-content">
                        Seleccioná una categoría.
                      </div>
                    </section>
                  `
                  : "<p>Este torneo ha finalizado.</p>"
          }

        </div>
      `).join("")
      : `<div class="notice-inline">Todavía no hay torneos disponibles.</div>`;

    tournaments.forEach(t => loadPublicRegistrations(t.id));

    tournaments
      .filter(t => t.status === "open")
      .forEach(t => loadPlayerTournamentData(t.id));
  }
}

// AGREGAR CATEGORÍA

$("adminTournamentsList").addEventListener("click", async e => {
  const btn = e.target.closest("[data-add-category]");
  if (!btn) return;

  const form = btn.closest(".category-form");
  const tournamentId = form.dataset.tournamentId;
  const input = form.querySelector('[name="category"]');
  const name = input.value.trim();

  if (!name) {
    toast("Ingresá el nombre de la categoría.");
    return;
  }

  try {
    await api(`/api/admin/tournaments/${tournamentId}/categories`, {
      method: "POST",
      body: JSON.stringify({ name })
    });

    input.value = "";

    toast("Categoría agregada correctamente.");

    await loadCategories(tournamentId);

  } catch (err) {
    toast(err.message);
  }
});

// CREAR TORNEO

$("tournamentForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    await api("/api/admin/tournaments", {
      method: "POST",
      body: JSON.stringify({
        name: $("tournamentName").value,
        description: $("tournamentDescription").value,
        start_date: $("tournamentStart").value,
        end_date: $("tournamentEnd").value
      })
    });

    $("tournamentForm").reset();

    toast("¡Torneo creado correctamente!");

    await loadTournaments();

  } catch (err) {
    toast(err.message);
  }
});

// ELIMINAR TORNEO

$("adminTournamentsList").addEventListener("click", async e => {
  const btn = e.target.closest("[data-delete-tournament]");
  if (!btn) return;

  const tournamentId = btn.dataset.deleteTournament;

  const confirmar = confirm(
    "¿Estás seguro de eliminar este torneo?\n\nSe borrarán también sus categorías e inscripciones. Esta acción no se puede deshacer."
  );

  if (!confirmar) return;

  try {
    await api(`/api/admin/tournaments/${tournamentId}`, {
      method: "DELETE"
    });

    toast("Torneo eliminado correctamente.");

    await loadTournaments();

  } catch (err) {
    toast(err.message);
  }
});

// GUARDAR MODIFICACIONES DE UN TORNEO

$("adminTournamentsList").addEventListener("submit", async e => {
  const form = e.target;

  if (!form.matches(".tournament-edit-form")) return;

  e.preventDefault();

  const data = new FormData(form);

  try {
    await api(`/api/admin/tournaments/${form.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: data.get("name"),
        description: data.get("description"),
        start_date: data.get("start_date"),
        end_date: data.get("end_date"),
        status: data.get("status")
      })
    });

    toast("¡Torneo actualizado!");

    await loadTournaments();

  } catch (err) {
    toast(err.message);
  }
});
// PAREJAS INSCRIPTAS VISIBLES PARA LOS JUGADORES

async function loadPublicRegistrations(tournamentId) {
  const container = $(`public-pairs-${tournamentId}`);
  if (!container) return;

  try {
    const registrations = await api(
      `/api/tournaments/${tournamentId}/registrations/list`
    );

    if (!registrations.length) {
      container.innerHTML =
        `<div class="notice-inline">Todavía no hay parejas inscriptas.</div>`;
      return;
    }

    const groups = {};

    registrations.forEach(r => {
      if (!groups[r.category_name]) groups[r.category_name] = [];
      groups[r.category_name].push(r);
    });

    container.innerHTML = Object.entries(groups).map(([category, pairs]) => `
      <div class="notice-inline">
        <strong>${esc(category)}</strong>
        ${pairs.map(r => `
          <p>🎾 ${esc(r.player1_name)} + ${esc(r.player2_name)}</p>
        `).join("")}
      </div>
    `).join("");

  } catch (e) {
    container.innerHTML =
      `<div class="notice-inline">No se pudieron cargar las parejas.</div>`;
  }
}

// INSCRIPCIONES DE PAREJAS

async function loadPlayerTournamentData(tournamentId) {
  const container = document.querySelector(
    `.player-registration[data-tournament-id="${tournamentId}"]`
  );

  if (!container) return;

  try {
    const [categories, players, mine] = await Promise.all([
      api(`/api/tournaments/${tournamentId}/categories`),
      api(`/api/tournaments/${tournamentId}/players`),
      api(`/api/tournaments/${tournamentId}/registrations/mine`)
    ]);

    const categorySelect = container.querySelector("[data-category]");
    const partnerSelect = container.querySelector("[data-partner]");
    const mineContainer = container.querySelector("[data-my-registrations]");

    categorySelect.innerHTML = categories.length
      ? `<option value="">Seleccioná una categoría</option>` +
        categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")
      : `<option value="">No hay categorías disponibles</option>`;

    partnerSelect.innerHTML = players.length
      ? `<option value="">Seleccioná tu compañero/a</option>` +
        players.map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("")
      : `<option value="">No hay otros jugadores aprobados</option>`;

    mineContainer.innerHTML = mine.length
      ? `<h4>Tus parejas inscriptas</h4>` + mine.map(r => `
          <div class="notice-inline">
            <strong>${esc(r.category_name || r.category || "Categoría")}</strong><br>
            ${esc(r.player1_name || r.player1 || "")} + ${esc(r.player2_name || r.player2 || "")}
            <span class="state approved">Inscripción confirmada</span>
          </div>
        `).join("")
      : `<div class="notice-inline">Todavía no estás inscripto/a en este torneo.</div>`;

  } catch (e) {
    toast(e.message);
  }
}

async function loadAdminRegistrations(tournamentId) {
  const container = $(`registrations-${tournamentId}`);
  if (!container) return;

  try {
    const registrations = await api(
      `/api/admin/tournaments/${tournamentId}/registrations`
    );

    container.innerHTML = registrations.length
      ? registrations.map(r => `
          <div class="user-card">
            <div class="user-info">
              <div class="user-name">
                ${esc(r.player1_name)} + ${esc(r.player2_name)}
              </div>

              <div class="user-meta">
                ${esc(r.category_name)} · ${r.status === "active" ? "Activa" : "Dada de baja"}
              </div>
            </div>

            <div class="user-actions">
              ${
                r.status === "active"
                  ? `<button class="reject" type="button" data-cancel-registration="${r.id}">DAR DE BAJA</button>`
                  : `<span class="state rejected">Baja</span>`
              }
            </div>
          </div>
        `).join("")
      : `<div class="notice-inline">Todavía no hay parejas inscriptas.</div>`;

  } catch (e) {
    container.innerHTML = `<div class="notice-inline">No se pudieron cargar las parejas.</div>`;
    toast(e.message);
  }
}

// Compatibilidad con el nombre singular usado en versiones anteriores.
const loadAdminRegistration = loadAdminRegistrations;

// CONFIRMAR INSCRIPCIÓN

$("playerTournaments").addEventListener("click", async e => {
  const btn = e.target.closest("[data-register-pair]");
  if (!btn) return;

  const container = btn.closest(".player-registration");
  const tournamentId = container.dataset.tournamentId;
  const categoryId = container.querySelector("[data-category]").value;
  const partnerId = container.querySelector("[data-partner]").value;

  if (!categoryId) return toast("Seleccioná una categoría.");
  if (!partnerId) return toast("Seleccioná tu compañero/a.");

  btn.disabled = true;

  try {
    const result = await api(`/api/tournaments/${tournamentId}/registrations`, {
      method: "POST",
      body: JSON.stringify({
        categoryId: Number(categoryId),
        partnerId: Number(partnerId)
      })
    });

    toast(result.message || "¡Pareja inscripta correctamente!");

    await loadPlayerTournamentData(tournamentId);

  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
});

// DAR DE BAJA UNA PAREJA

$("adminTournamentsList").addEventListener("click", async e => {
  const btn = e.target.closest("[data-cancel-registration]");
  if (!btn) return;

  if (!confirm("¿Dar de baja esta pareja? Ambos jugadores podrán volver a inscribirse.")) {
    return;
  }

  try {
    await api(`/api/admin/registrations/${btn.dataset.cancelRegistration}/cancel`, {
      method: "PATCH",
      body: "{}"
    });

    toast("Pareja dada de baja. Los jugadores ya pueden volver a inscribirse.");

    await loadTournaments();

  } catch (err) {
    toast(err.message);
  }
});
// ÁREA DE DESAFÍOS

function challengePairName(pair) {
  if (!pair) return "Pareja";
  return `${pair.player1_name || "Jugador 1"} + ${pair.player2_name || "Jugador 2"}`;
}
function challengeDetails(match) {
  const date = match.match_date
    ? match.match_date.split("-").reverse().join("/")
    : "";

  return `
    <div class="challenge-details">
      <p><strong>Cancha:</strong> ${esc(match.court || "")}</p>
      <p><strong>Lugar:</strong> ${esc(match.place || "")}</p>
      <p><strong>Día:</strong> ${esc(date)}</p>
      <p><strong>Horario:</strong> ${esc(match.match_time || "")} hs</p>
    </div>
  `;
}

async function openChallengeArea(tournamentId) {
  const area = $(`challenge-area-${tournamentId}`);
  if (!area) return;

  area.classList.remove("hidden");
  const select = area.querySelector("[data-challenge-category]");
  const content = area.querySelector("[data-challenge-content]");
  content.textContent = "Cargando categorías...";

  try {
    const categories = await api(`/api/tournaments/${tournamentId}/categories`);
    select.innerHTML = categories.length
      ? `<option value="">Seleccioná una categoría</option>` +
        categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")
      : `<option value="">No hay categorías</option>`;

    if (!categories.length) {
      content.innerHTML = `<div class="notice-inline">No hay categorías cargadas.</div>`;
      return;
    }

    select.value = String(categories[0].id);
    await loadChallengeBoard(tournamentId, categories[0].id);
  } catch (err) {
    content.innerHTML = `<div class="notice-inline">No se pudieron cargar las categorías.</div>`;
    toast(err.message);
  }
}

async function loadChallengeBoard(tournamentId, categoryId) {
  const area = $(`challenge-area-${tournamentId}`);
  if (!area || !categoryId) return;

  const content = area.querySelector("[data-challenge-content]");
  content.textContent = "Cargando desafíos...";

  try {
    const data = await api(`/api/tournaments/${tournamentId}/challenges?categoryId=${encodeURIComponent(categoryId)}`);
    const pairs = data.registrations || [];
    const challenges = data.challenges || [];
    const mine = data.myRegistration;

    if (!mine) {
      content.innerHTML = `<div class="notice-inline">No tenés una pareja inscripta en esta categoría.</div>`;
      return;
    }

    const myId = Number(mine.id);
    const opponents = pairs.filter(pair => Number(pair.id) !== myId);
    const completedOpponents = new Set();

    challenges.filter(match => match.status === "completed").forEach(match => {
      if (Number(match.creator_registration_id) === myId) {
        completedOpponents.add(Number(match.opponent_registration_id));
      } else if (Number(match.opponent_registration_id) === myId) {
        completedOpponents.add(Number(match.creator_registration_id));
      }
    });

    const completed = completedOpponents.size;
    const total = opponents.length;
    const pending = Math.max(0, total - completed);
    const percent = total ? Math.round(completed / total * 100) : 0;

    const related = challenges.filter(match =>
      Number(match.creator_registration_id) === myId ||
      Number(match.opponent_registration_id) === myId
    );

    const ownOpen = challenges.find(match =>
      match.status === "open" && Number(match.creator_registration_id) === myId
    );

    const ownPlaying = challenges.find(match =>
      match.status === "playing" && Number(match.creator_registration_id) === myId
    );

    const myActive = related.find(match => ["open", "playing"].includes(match.status));

    const pairProgress = opponents.map(pair => {
      const opponentId = Number(pair.id);
      const match = challenges.find(item =>
        item.status !== "cancelled" &&
        ((Number(item.creator_registration_id) === myId && Number(item.opponent_registration_id) === opponentId) ||
         (Number(item.creator_registration_id) === opponentId && Number(item.opponent_registration_id) === myId))
      );

      let state = "Pendiente";
      if (completedOpponents.has(opponentId)) state = "Finalizado";
      else if (match?.status === "playing") state = "En curso";
      else if (match?.status === "open") state = "Desafío publicado";

      return `<div class="notice-inline"><strong>${esc(challengePairName(pair))}</strong><p>${state}</p></div>`;
    }).join("");

    const available = challenges.filter(match =>
      match.status === "open" && Number(match.creator_registration_id) !== myId
    );

    function renderPlaying(match) {
      const creator = pairs.find(pair => Number(pair.id) === Number(match.creator_registration_id));
      const opponent = pairs.find(pair => Number(pair.id) === Number(match.opponent_registration_id));
      const canCancel = Number(match.created_by_user_id) === Number(currentUser.id);

      return `<div class="notice-inline challenge-match">
              ${challengeDetails(match)}
        <strong>${esc(challengePairName(creator))}</strong>
        <p>VS.</p>
        <strong>${esc(challengePairName(opponent))}</strong>
        <label class="form-label">Resultado de los sets (ej.: 6-4)</label>
        <input class="field" data-set1 placeholder="1° set" value="${esc(match.set1 || "")}">
        <input class="field" data-set2 placeholder="2° set" value="${esc(match.set2 || "")}">
        <input class="field" data-set3 placeholder="3° set (si corresponde)" value="${esc(match.set3 || "")}">
        <button class="button primary full" type="button" data-save-score="${match.id}">GUARDAR RESULTADO</button>
        <button class="button primary full" type="button" data-finish-match="${match.id}">FINALIZAR PARTIDO</button>
        ${canCancel ? `<button class="button reject full" type="button" data-cancel-match="${match.id}">CANCELAR DESAFÍO</button>` : ""}
      </div>`;
    }

   const finished = related.filter(match => match.status === "completed").map(match => {
  const creator = pairs.find(pair => Number(pair.id) === Number(match.creator_registration_id));
  const opponent = pairs.find(pair => Number(pair.id) === Number(match.opponent_registration_id));

  const editButton = Number(match.score_edit_used) === 0
  ? `<button class="button primary full" type="button"
       data-edit-score="${match.id}"
       data-set1="${esc(match.set1 || "")}"
       data-set2="${esc(match.set2 || "")}"
       data-set3="${esc(match.set3 || "")}">
       EDITAR RESULTADO
     </button>`
  : `<span class="state rejected">Edición utilizada</span>`;

  return `<div class="notice-inline">
    <strong>${esc(challengePairName(creator))} vs. ${esc(challengePairName(opponent))}</strong>
    ${challengeDetails(match)}
    <p>${esc([match.set1, match.set2, match.set3].filter(Boolean).join(" · "))}</p>
    <span class="state approved">Finalizado</span>
    ${editButton}
  </div>`;
}).join("");

    content.innerHTML = `
      <div class="notice-inline">
        <h4>Tu pareja: ${esc(challengePairName(mine))}</h4>
        <strong>${completed} de ${total} partidos jugados</strong>
        <p>Te faltan ${pending} enfrentamientos.</p>
        <div style="height:9px;background:#e8e8e8;border-radius:20px;overflow:hidden">
          <div style="height:100%;width:${percent}%;background:#6950a1"></div>
        </div>
      </div>

      <h4>Enfrentamientos de tu pareja</h4>
      ${pairProgress || `<div class="notice-inline">No hay otras parejas inscriptas.</div>`}

      <h4>Publicar un desafío</h4>
${myActive
  ? `<div class="notice-inline">Tu pareja ya tiene un desafío activo. Finalizalo o cancelalo para publicar otro.</div>`
  : `
    <div class="notice-inline">
      <label class="form-label">Cancha</label>
      <input class="field" type="text" data-challenge-court placeholder="Ej. Cancha 1" required>

      <label class="form-label">Lugar</label>
      <input class="field" type="text" data-challenge-place placeholder="Ej. Padel C.D.B." required>

      <label class="form-label">Día del partido</label>
      <input class="field" type="date" data-challenge-date required>

      <label class="form-label">Horario</label>
      <input class="field" type="time" data-challenge-time required>

      <button
        class="button primary full"
        type="button"
        data-create-challenge="${tournamentId}"
        data-category="${categoryId}"
      >
        PUBLICAR DESAFÍO
      </button>
    </div>
  `
}

      ${ownOpen ? `<div class="notice-inline">
        ${challengeDetails(ownOpen)}
        Tu desafío está publicado. Esperando que otra pareja se anote.
        <button class="button reject full" type="button" data-cancel-match="${ownOpen.id}">CANCELAR DESAFÍO</button>
      </div>` : ""}

      ${ownPlaying ? `<div class="notice-inline">Tu desafío ya tiene rival y está en curso.</div>` : ""}

      <h4>Desafíos disponibles</h4>
      ${available.length ? available.map(match => {
        const creator = pairs.find(pair => Number(pair.id) === Number(match.creator_registration_id));
        const eligiblePairs = pairs.filter(pair => Number(pair.id) !== Number(match.creator_registration_id));

        return `<div class="notice-inline">
          <strong>${esc(challengePairName(creator))}</strong>
                    ${challengeDetails(match)}
          <p>Está buscando rival en esta categoría.</p>
          <label class="form-label">Elegí tu pareja</label>
          <select class="field" data-join-pair="${match.id}">
            <option value="">Seleccioná tu pareja</option>
            ${eligiblePairs.map(pair => `<option value="${pair.id}">${esc(challengePairName(pair))}</option>`).join("")}
          </select>
          <button class="button primary full" type="button" data-join-challenge="${match.id}">ANOTAR MI PAREJA</button>
        </div>`;
      }).join("") : `<div class="notice-inline">No hay desafíos publicados por otras parejas.</div>`}

      <h4>Partidos en curso</h4>
      ${related.filter(match => match.status === "playing").map(renderPlaying).join("") ||
        `<div class="notice-inline">No tenés partidos en curso.</div>`}

      <h4>Partidos finalizados</h4>
      ${finished || `<div class="notice-inline">Todavía no finalizaste partidos.</div>`}

      <button class="button light full" type="button" data-refresh-challenges="${tournamentId}">ACTUALIZAR DESAFÍOS</button>
    `;
  } catch (err) {
    content.innerHTML = `<div class="notice-inline">No se pudo cargar el área de desafíos.</div>`;
    toast(err.message);
  }
}

// CAMBIAR CATEGORÍA EN EL ÁREA DE DESAFÍOS

$("playerTournaments").addEventListener("change", async e => {
  const select = e.target.closest("[data-challenge-category]");
  if (!select) return;

  const area = select.closest(".challenge-area");
  const tournamentId = area.id.replace("challenge-area-", "");
  await loadChallengeBoard(tournamentId, select.value);
});


 // ACCIONES DEL ÁREA DE DESAFÍOS

$("playerTournaments").addEventListener("click", async e => {

  // ABRIR ÁREA DE DESAFÍOS
  const open = e.target.closest("[data-open-challenges]");
  if (open) {
    await openChallengeArea(open.dataset.openChallenges);
    return;
  }

  // CERRAR ÁREA DE DESAFÍOS
  const close = e.target.closest("[data-close-challenges]");
  if (close) {
    $(`challenge-area-${close.dataset.closeChallenges}`).classList.add("hidden");
    return;
  }

  // ACTUALIZAR DESAFÍOS
  const refresh = e.target.closest("[data-refresh-challenges]");
  if (refresh) {
    const area = $(`challenge-area-${refresh.dataset.refreshChallenges}`);

    await loadChallengeBoard(
      refresh.dataset.refreshChallenges,
      area.querySelector("[data-challenge-category]").value
    );
    return;
  }

  // PUBLICAR DESAFÍO
  const create = e.target.closest("[data-create-challenge]");
  if (create) {
    const area = create.closest(".challenge-area");

    const court = area.querySelector("[data-challenge-court]").value.trim();
    const place = area.querySelector("[data-challenge-place]").value.trim();
    const matchDate = area.querySelector("[data-challenge-date]").value;
    const matchTime = area.querySelector("[data-challenge-time]").value;

    if (!court || !place || !matchDate || !matchTime) {
      return toast("Completá cancha, lugar, día y horario.");
    }

    if (!confirm("¿Publicar este desafío con los datos del partido?")) return;

    create.disabled = true;

    try {
      await api(`/api/tournaments/${create.dataset.createChallenge}/challenges`, {
        method: "POST",
        body: JSON.stringify({
          categoryId: Number(create.dataset.category),
          court,
          place,
          matchDate,
          matchTime
        })
      });

      toast("Desafío publicado.");

      await loadChallengeBoard(
        create.dataset.createChallenge,
        create.dataset.category
      );

    } catch (err) {
      toast(err.message);
    } finally {
      create.disabled = false;
    }

    return;
  }

  // ANOTAR SEGUNDA PAREJA
  const join = e.target.closest("[data-join-challenge]");
  if (join) {
    const area = join.closest(".challenge-area");

    const select = area.querySelector(
      `[data-join-pair="${join.dataset.joinChallenge}"]`
    );

    const registrationId = select?.value;

    if (!registrationId) {
      return toast("Seleccioná tu pareja.");
    }

    if (!confirm("¿Anotar tu pareja en este desafío?")) return;

    join.disabled = true;

    try {
      await api(`/api/challenges/${join.dataset.joinChallenge}/join`, {
        method: "POST",
        body: JSON.stringify({
          registrationId: Number(registrationId)
        })
      });

      toast("¡Tu pareja quedó anotada!");

      await loadChallengeBoard(
        area.id.replace("challenge-area-", ""),
        area.querySelector("[data-challenge-category]").value
      );

    } catch (err) {
      toast(err.message);
    } finally {
      join.disabled = false;
    }

    return;
  }

  // CANCELAR DESAFÍO
  const cancel = e.target.closest("[data-cancel-match]");
  if (cancel) {
    if (!confirm("¿Cancelar el desafío? Ambas parejas volverán a tener este partido pendiente.")) {
      return;
    }

    const area = cancel.closest(".challenge-area");

    try {
      await api(`/api/challenges/${cancel.dataset.cancelMatch}/cancel`, {
        method: "PATCH",
        body: "{}"
      });

      toast("Desafío cancelado.");

      await loadChallengeBoard(
        area.id.replace("challenge-area-", ""),
        area.querySelector("[data-challenge-category]").value
      );

    } catch (err) {
      toast(err.message);
    }

    return;
  }
    // EDITAR RESULTADO FINALIZADO (UNA SOLA VEZ)
  const editScoreButton = e.target.closest("[data-edit-score]");

  if (editScoreButton) {
    const matchId = editScoreButton.dataset.editScore;
    const area = editScoreButton.closest(".challenge-area");

    const set1 = window.prompt(
      "Corregí el primer set (ejemplo: 6-4):",
      editScoreButton.dataset.set1
    );
    if (set1 === null) return;

    const set2 = window.prompt(
      "Corregí el segundo set (ejemplo: 3-6):",
      editScoreButton.dataset.set2
    );
    if (set2 === null) return;

    const set3 = window.prompt(
      "Tercer set (dejalo vacío si no hubo):",
      editScoreButton.dataset.set3
    );
    if (set3 === null) return;

    if (!window.confirm("¿Confirmás guardar la corrección? Esta edición no se podrá repetir.")) {
      return;
    }

    try {
      await api(`/api/challenges/${matchId}/score`, {
        method: "PUT",
        body: JSON.stringify({
          set1: set1.trim(),
          set2: set2.trim(),
          set3: set3.trim()
        })
      });

      toast("Resultado corregido correctamente.");

      await loadChallengeBoard(
        area.id.replace("challenge-area-", ""),
        area.querySelector("[data-challenge-category]").value
      );

    } catch (err) {
      toast(err.message);
    }

    return;
  } 

  // GUARDAR RESULTADO O FINALIZAR PARTIDO
  const scoreButton = e.target.closest(
    "[data-save-score], [data-finish-match]"
  );

  if (scoreButton) {
    const matchCard = scoreButton.closest(".challenge-match");
    const area = scoreButton.closest(".challenge-area");

    const matchId =
      scoreButton.dataset.saveScore ||
      scoreButton.dataset.finishMatch;

    const score = {
      set1: matchCard.querySelector("[data-set1]").value.trim(),
      set2: matchCard.querySelector("[data-set2]").value.trim(),
      set3: matchCard.querySelector("[data-set3]").value.trim()
    };

    try {
      await api(`/api/challenges/${matchId}/score`, {
        method: "PUT",
        body: JSON.stringify(score)
      });

      if (scoreButton.matches("[data-finish-match]")) {
        await api(`/api/challenges/${matchId}/finish`, {
          method: "POST",
          body: "{}"
        });

        toast("¡Partido finalizado!");

        await loadChallengeBoard(
          area.id.replace("challenge-area-", ""),
          area.querySelector("[data-challenge-category]").value
        );

      } else {
        toast("Resultado guardado.");
      }

    } catch (err) {
      toast(err.message);
    }
  }

});

// ABRIR RANKING DEL TORNEO

document.addEventListener("click", e => {
  const btn = e.target.closest("[data-open-ranking]");
  if (!btn) return;

  const tournamentId = btn.dataset.openRanking;

  window.location.href =
    `/ranking.html?tournamentId=${tournamentId}`;
});

checkSession();