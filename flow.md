(24-03-2026)  
Root cause: The ombre emboss URL was being passed as textureUrl — which renders in the pattern layer at z-index 2. The T-Patti sits at z-index 3, putting it naturally in front.  
- - -
- - -
<div></div>