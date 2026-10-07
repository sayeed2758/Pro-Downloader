// UI Controller
const UI = {
    views: ['home', 'downloader', 'history', 'videos', 'tabs', 'result'],
    
    init() {
        this.bindEvents();
        this.showView('home');
    },

    bindEvents() {
        // Bottom Nav Logic
        document.querySelectorAll('.nav-item').forEach((btn, index) => {
            btn.onclick = () => {
                const viewName = this.views[index];
                this.showView(viewName);
                this.updateNav(btn);
            };
        });

        // Resolve Button Trigger
        const resolveBtn = document.getElementById('resolve-btn');
        if(resolveBtn) {
            resolveBtn.onclick = () => this.handleResolve();
        }
    },

    showView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        const activeView = document.getElementById(`view-${viewId}`);
        if(activeView) activeView.classList.remove('hidden');
    },

    updateNav(activeBtn) {
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active-nav', 'text-[#6254C9]'));
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.add('text-gray-400'));
        activeBtn.classList.add('active-nav', 'text-[#6254C9]');
        activeBtn.classList.remove('text-gray-400');
    },

    async handleResolve() {
        const input = document.getElementById('downloader-url-input');
        const url = input.value.trim();

        if(!url) {
            alert("Please paste a valid link.");
            return;
        }

        // Show Loading State (Section 15 Requirement)
        const btn = document.getElementById('resolve-btn');
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerText = "Processing Link...";

        try {
            // This will call our Phase 4 Backend
            console.log("Resolving URL:", url);
            // Simulate Success for Phase 2 UI testing
            setTimeout(() => {
                btn.disabled = false;
                btn.innerText = originalText;
                this.showView('result');
                this.renderMockResult();
            }, 1500);
        } catch (error) {
            btn.disabled = false;
            btn.innerText = originalText;
            alert("Failed to resolve link.");
        }
    },

    renderMockResult() {
        const list = document.getElementById('format-list');
        list.innerHTML = `
            <div class="flex items-center justify-between p-4 bg-purple-50 border border-purple-100 rounded-2xl border-2 border-[#6254C9]">
                <div class="flex items-center gap-3">
                    <i class="fa-solid fa-video text-[#6254C9]"></i>
                    <div>
                        <p class="font-bold text-sm">1080p Full HD</p>
                        <p class="text-[10px] text-gray-500">MP4 • 45.2 MB</p>
                    </div>
                </div>
                <button class="bg-[#6254C9] text-white px-4 py-2 rounded-xl text-xs font-bold">Download</button>
            </div>
            <div class="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl hover:border-purple-200 transition-colors">
                <div class="flex items-center gap-3">
                    <i class="fa-solid fa-video text-gray-400"></i>
                    <div>
                        <p class="font-bold text-sm">720p HD</p>
                        <p class="text-[10px] text-gray-500">MP4 • 22.1 MB</p>
                    </div>
                </div>
                <button class="bg-gray-100 text-gray-600 px-4 py-2 rounded-xl text-xs font-bold">Download</button>
            </div>
        `;
    }
};

// Initialize UI
document.addEventListener('DOMContentLoaded', () => UI.init());