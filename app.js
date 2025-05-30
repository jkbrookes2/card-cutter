// top of app.js
import * as pdfjsLib from
  'https://unpkg.com/pdfjs-dist@4.3.136/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://unpkg.com/pdfjs-dist@4.3.136/build/pdf.worker.min.mjs';

const fileInput = document.getElementById('fileInput');
const cardsContainer = document.getElementById('cardsContainer');

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileReader = new FileReader();
    fileReader.onload = async function() {
        const typedArray = new Uint8Array(this.result);
        const pdf = await pdfjsLib.getDocument(typedArray).promise;
        
        cardsContainer.innerHTML = '';

        for(let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({scale: 1.5});
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const ctx = canvas.getContext('2d');
            await page.render({canvasContext: ctx, viewport}).promise;

            const img = document.createElement('img');
            img.src = canvas.toDataURL();
            cardsContainer.appendChild(img);
        }
    };
    fileReader.readAsArrayBuffer(file);
});