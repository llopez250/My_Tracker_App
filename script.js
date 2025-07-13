import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, collection, addDoc, onSnapshot, updateDoc, deleteDoc, serverTimestamp, getDocs, writeBatch, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- App State ---
let app, db, auth, userId;
let isAuthReady = false;
let currentWeekId = null;
let allWeeks = [];
let unsubscribeFromTasks = null;

// --- DOM Elements ---
const weekTitle = document.getElementById('weekTitle');
const weekSelector = document.getElementById('weekSelector');
const newWeekBtn = document.getElementById('newWeekBtn');
const addTaskForm = document.getElementById('addTaskForm');
const taskInput = document.getElementById('taskInput');
const columns = document.querySelectorAll('.kanban-column');
const weeklyProgressBar = document.getElementById('weeklyProgressBar');
const userIdDisplay = document.getElementById('userIdDisplay');
const editModal = document.getElementById('editModal');
const editTaskForm = document.getElementById('editTaskForm');
const editTaskIdInput = document.getElementById('editTaskId');
const editTaskTextInput = document.getElementById('editTaskText');
const cancelEditBtn = document.getElementById('cancelEdit');
const addTaskContainer = document.getElementById('addTaskContainer');

// --- Date Helper Functions ---
const getMonday = (d) => {
    d = new Date(d);
    const day = d.getDay(),
        diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    return new Date(d.setDate(diff));
};

const formatDate = (d) => {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
};

const getWeekId = (d) => {
    const monday = getMonday(d);
    return `${monday.getFullYear()}-W${String(monday.getMonth() + 1).padStart(2,'0')}${String(monday.getDate()).padStart(2,'0')}`;
};

// --- Confetti ---
function triggerConfetti() {
    const duration = 2 * 1000;
    const animationEnd = Date.now() + duration;
    const colors = ['#22c55e', '#16a34a', '#facc15', '#eab308']; // Greens & Golds

    (function frame() {
      confetti({
        particleCount: 2,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: colors,
        shapes: ['square', 'circle']
      });
      confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: colors,
        shapes: ['square', 'circle']
      });

      if (Date.now() < animationEnd) {
        requestAnimationFrame(frame);
      }
    }());
}

// --- UI Rendering ---
function updateProgressBar(tasks) {
    const doneTasks = tasks.filter(task => task.completed).length;
    const totalTasks = tasks.length;
    const percentage = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    weeklyProgressBar.style.width = `${percentage}%`;
    weeklyProgressBar.textContent = `${percentage}%`;
}

function renderTasks(tasks) {
    columns.forEach(col => { col.querySelector('.task-list').innerHTML = ''; });
    tasks.forEach(task => {
        const column = document.getElementById(task.status);
        if (column) {
            const card = createTaskCard(task);
            column.querySelector('.task-list').appendChild(card);
        }
    });
    updateProgressBar(tasks);
}

function populateWeekSelector() {
    weekSelector.innerHTML = '';
    allWeeks.forEach(week => {
        const option = document.createElement('option');
        option.value = week.id;
        const dateObj = week.startDate.toDate ? week.startDate.toDate() : week.startDate;
        option.textContent = `Week of ${formatDate(dateObj)}`;
        option.selected = week.id === currentWeekId;
        weekSelector.appendChild(option);
    });
}

function createTaskCard(task) {
    const card = document.createElement('div');
    card.id = task.id;
    card.className = 'task-card bg-gray-50 p-3 rounded-lg shadow-sm border border-gray-200 hover:shadow-md flex items-start gap-3';
    card.draggable = !task.completed;

    const completeBtn = document.createElement('div');
    completeBtn.className = 'complete-btn flex-shrink-0';
    completeBtn.onclick = () => toggleTaskComplete(task.id, task.completed);
    
    if (task.completed) {
        card.classList.add('is-done');
        completeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-check-circle-fill text-green-500 hover:text-green-600" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/></svg>`;
    } else {
        completeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-circle text-gray-400 hover:text-green-500" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/></svg>`;
    }
    card.appendChild(completeBtn);

    const contentWrap = document.createElement('div');
    contentWrap.className = 'flex-grow';
    const text = document.createElement('p');
    text.textContent = task.text;
    text.className = 'task-text text-gray-800';
    contentWrap.appendChild(text);
    
    if (!task.completed) {
        const controls = document.createElement('div');
        controls.className = 'flex justify-end items-center gap-2 mt-2';
        const editBtn = document.createElement('button');
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil-square text-gray-500 hover:text-indigo-600" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/></svg>`;
        editBtn.onclick = () => openEditModal(task);
        controls.appendChild(editBtn);
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash3-fill text-gray-50