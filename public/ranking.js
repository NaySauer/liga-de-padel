
const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const tournamentId = params.get("tournamentId");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

// CARGAR CATEGORÍAS DEL TORNEO
async function loadRankingCategories() {
  const select = $("rankingCategory");

  if (!tournamentId) {
    select.innerHTML = '<option value="">Torneo no especificado</option>';
    return;
  }

  try {
    const response = await fetch(
      `/api/tournaments/${tournamentId}/categories`
    );

    if (!response.ok) throw new Error("No se pudieron cargar las categorías.");

    const categories = await response.json();

    if (!categories.length) {
      select.innerHTML = '<option value="">No hay categorías cargadas</option>';
      return;
    }

    select.innerHTML =
      '<option value="">Seleccioná una categoría</option>' +
      categories.map(category =>
        `<option value="${category.id}">${esc(category.name)}</option>`
      ).join("");

    select.value = String(categories[0].id);
    await loadRanking(categories[0].id);

  } catch (error) {
    select.innerHTML = '<option value="">Error al cargar categorías</option>';
    console.error(error);
  }
}

// CARGAR RANKING DE UNA CATEGORÍA
async function loadRanking(categoryId) {
  const table = $("rankingTable");
  const title = $("rankingCategoryName");

  table.innerHTML = `
    <tr><td colspan="5">Cargando ranking...</td></tr>
  `;

  try {
    const response = await fetch(
      `/api/tournaments/${tournamentId}/ranking?categoryId=${categoryId}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "No se pudo cargar el ranking.");
    }

    title.textContent = data.categoryName;

    table.innerHTML = data.ranking.length
      ? data.ranking.map(pair => `
          <tr>
            <td>${esc(pair.pair)}</td>
            <td>${pair.played}</td>
            <td>${pair.wins}</td>
            <td>${pair.losses}</td>
            <td><strong>${pair.points}</strong></td>
          </tr>
        `).join("")
      : '<tr><td colspan="5">Todavía no hay parejas inscriptas.</td></tr>';

  } catch (error) {
    table.innerHTML = `
      <tr><td colspan="5">${esc(error.message)}</td></tr>
    `;
  }
}

// CAMBIAR CATEGORÍA
$("rankingCategory").addEventListener("change", event => {
  if (event.target.value) {
    loadRanking(event.target.value);
  }
});

loadRankingCategories();
