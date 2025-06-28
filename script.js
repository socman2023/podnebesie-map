let locations = [];
const mapImage = document.getElementById('main-map');
const overlay = document.getElementById('overlay');
const tooltip = document.getElementById('tooltip');
const titleEl = document.getElementById('tooltip-title');
const imgEl = document.getElementById('tooltip-image');
const descEl = document.getElementById('tooltip-description');
const linksEl = document.getElementById('tooltip-links');
const closeBtn = document.getElementById('close-tooltip');

let canvasScale = 1;

// Обработчик загрузки изображения карты
mapImage.onload = function() {
  resizeCanvas();
  drawPoints();
};

fetch('locations.json')
  .then(res => res.json())
  .then(data => {
    locations = data;
    console.log('Загружено локаций:', locations.length);
    // Если изображение уже загружено, инициализируем canvas
    if (mapImage.complete) {
      resizeCanvas();
      drawPoints();
    }
  })
  .catch(err => console.error("Ошибка загрузки locations.json:", err));

function resizeCanvas() {
  overlay.width = mapImage.clientWidth;
  overlay.height = mapImage.clientHeight;
  canvasScale = mapImage.clientWidth / mapImage.naturalWidth;
  console.log('Canvas resized, scale:', canvasScale);
}

function drawPoints() {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  
  locations.forEach(loc => {
    const x = loc.x * canvasScale;
    const y = loc.y * canvasScale;
    
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = getColorByType(loc.type);
    ctx.fill();
    ctx.strokeStyle = '#2c1a0a';
    ctx.stroke();
  });
}

function getColorByType(type) {
  switch (type) {
    case 'water': return 'skyblue';
    case 'mountain': return 'green';
    case 'state': return 'darkred';
    case 'city': return 'orange';
    case 'region': return 'olive';
    case 'tribe': return 'purple';
    case 'object': return 'brown';
    case 'place': return 'darkgreen';
    case 'landmark': return 'gold';
    case 'link': return 'blue';
    default: return 'black';
  }
}

overlay.addEventListener('click', function(e) {
  const rect = overlay.getBoundingClientRect();
  const scaleX = overlay.width / rect.width;
  const scaleY = overlay.height / rect.height;
  
  const xClick = (e.clientX - rect.left) * scaleX / canvasScale;
  const yClick = (e.clientY - rect.top) * scaleY / canvasScale;

  console.log('Clicked at:', xClick, yClick); // Для отладки

  const found = locations.find(loc => {
    const dx = loc.x - xClick;
    const dy = loc.y - yClick;
    return Math.sqrt(dx * dx + dy * dy) < 20;
  });

  if (found) {
    console.log('Found location:', found.title); // Для отладки
    showTooltip(found);
  }
});

function showTooltip(loc) {
  titleEl.textContent = loc.title;
  
  if (loc.image && loc.image.trim() !== "") {
    imgEl.src = loc.image;
    imgEl.alt = loc.title;
    imgEl.style.display = "block";
  } else {
    imgEl.style.display = "none";
  }
  
  descEl.innerHTML = loc.description || "";
  
  linksEl.innerHTML = "";
  if (loc.links && loc.links.length > 0) {
    loc.links.forEach(link => {
      const a = document.createElement('a');
      a.textContent = link.text;
      a.href = "#";
      a.onclick = (e) => {
        e.preventDefault();
        const target = locations.find(l => l.id === link.target);
        if (target) showTooltip(target);
        return false;
      };
      linksEl.appendChild(a);
    });
  }
  
  tooltip.classList.remove("hidden");
}

closeBtn.addEventListener('click', () => {
  tooltip.classList.add("hidden");
});

window.addEventListener('resize', () => {
  resizeCanvas();
  drawPoints();
});