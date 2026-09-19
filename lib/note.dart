class Note {
  String id;
  String title;
  String text;

  Note({required this.id, required this.title, required this.text});

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'title': title,
      'text': text,
    };
  }

  factory Note.fromMap(Map<String, dynamic> map) {
    return Note(
      id: map['id'],
      title: map['title'],
      text: map['text'],
    );
  }
}
