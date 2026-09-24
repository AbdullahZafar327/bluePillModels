
(function () {
    "use strict";
    
    onmessage = async (event) => {
        const { url, flipY } = event.data;
        
        
        try {
            // Fetch the image
            const response = await fetch(url);
            
            if (!response.ok) {
                console.error('Bitmap Worker: Fetch failed', response.status, url);
                postMessage({ error: true });
                return;
            }
            
            const blob = await response.blob();
            
            // Create bitmap with options (native browser API)
            const options = {
                imageOrientation: flipY ? 'flipY' : 'none',
                premultiplyAlpha: 'none'
            };
            
            const bitmap = await createImageBitmap(blob, options);
            
            
            // Transfer the bitmap back to main thread
            postMessage({ bitmap }, [bitmap]);
            
        } catch (error) {
            console.error('Bitmap Worker: Error loading', url, error);
            postMessage({ error: true });
        }
    };
})();