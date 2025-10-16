"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTextContent = extractTextContent;
function extractTextContent(content) {
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (part.type === 'image_url') {
                return '[IMAGE]';
            }
            else if (part.type === 'text') {
                return part.text;
            }
            return '';
        })
            .join(' ');
    }
    return content;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL3Vzci9zcmMvYXBwL3NyYy91dGlscy90ZXh0LnRzIiwic291cmNlcyI6WyIvdXNyL3NyYy9hcHAvc3JjL3V0aWxzL3RleHQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFhQSxnREFjQztBQWRELFNBQWdCLGtCQUFrQixDQUFDLE9BQWdDO0lBQ2pFLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQzNCLE9BQU8sT0FBTzthQUNYLEdBQUcsQ0FBQyxDQUFDLElBQXdCLEVBQUUsRUFBRTtZQUNoQyxJQUFJLElBQUksQ0FBQyxJQUFJLEtBQUssV0FBVyxFQUFFLENBQUM7Z0JBQzlCLE9BQU8sU0FBUyxDQUFDO1lBQ25CLENBQUM7aUJBQU0sSUFBSSxJQUFJLENBQUMsSUFBSSxLQUFLLE1BQU0sRUFBRSxDQUFDO2dCQUNoQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUM7WUFDbkIsQ0FBQztZQUNELE9BQU8sRUFBRSxDQUFDO1FBQ1osQ0FBQyxDQUFDO2FBQ0QsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2YsQ0FBQztJQUNELE9BQU8sT0FBaUIsQ0FBQztBQUMzQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBUZXh0IHV0aWxpdGllcyBmb3Igbm9ybWFsaXphdGlvbiBhbmQgY29tcGFyaXNvbi5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IE1lc3NhZ2VDb250ZW50LCBNZXNzYWdlQ29udGVudFBhcnQgfSBmcm9tICcuLi9saWIvYWknO1xuXG4vKipcbiAqIEV4dHJhY3RzIHRleHQgY29udGVudCBmcm9tIG1lc3NhZ2UgY29udGVudCBhcnJheSwgcmVwbGFjaW5nIGltYWdlcyB3aXRoIFtJTUFHRV0gcGxhY2Vob2xkZXJzLlxuICogSGFuZGxlcyBib3RoIHN0cnVjdHVyZWQgbWVzc2FnZSBjb250ZW50IGFycmF5cyBhbmQgcGxhaW4gdGV4dCBzdHJpbmdzLlxuICpcbiAqIEBwYXJhbSBjb250ZW50IC0gTWVzc2FnZSBjb250ZW50IGZyb20gTGFuZ0NoYWluIChhcnJheSBvZiBwYXJ0cyBvciBwbGFpbiBzdHJpbmcpXG4gKiBAcmV0dXJucyBFeHRyYWN0ZWQgdGV4dCB3aXRoIGltYWdlIHBsYWNlaG9sZGVycyBmb3IgbXVsdGltb2RhbCBjb250ZW50XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0VGV4dENvbnRlbnQoY29udGVudDogTWVzc2FnZUNvbnRlbnQgfCBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoQXJyYXkuaXNBcnJheShjb250ZW50KSkge1xuICAgIHJldHVybiBjb250ZW50XG4gICAgICAubWFwKChwYXJ0OiBNZXNzYWdlQ29udGVudFBhcnQpID0+IHtcbiAgICAgICAgaWYgKHBhcnQudHlwZSA9PT0gJ2ltYWdlX3VybCcpIHtcbiAgICAgICAgICByZXR1cm4gJ1tJTUFHRV0nO1xuICAgICAgICB9IGVsc2UgaWYgKHBhcnQudHlwZSA9PT0gJ3RleHQnKSB7XG4gICAgICAgICAgcmV0dXJuIHBhcnQudGV4dDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJyc7XG4gICAgICB9KVxuICAgICAgLmpvaW4oJyAnKTtcbiAgfVxuICByZXR1cm4gY29udGVudCBhcyBzdHJpbmc7XG59XG4iXX0=